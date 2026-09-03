import { Router, type IRouter } from 'express';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, presentationsTable, quizAttemptsTable, quizzesTable, type QuizQuestion } from '@workspace/db';
import {
  GeneratePresentationQuizBody,
  GeneratePresentationQuizParams,
  GeneratePresentationQuizResponse,
  GradePresentationQuizBody,
  GradePresentationQuizParams,
  GradePresentationQuizResponse,
  GetPresentationQuizParams,
  GetPresentationQuizResponse,
  GetQuizResultsBody,
  GetQuizResultsParams,
  GetQuizResultsResponse,
  SubmitQuizAttemptBody,
  SubmitQuizAttemptParams,
  SubmitQuizAttemptResponse,
} from '@workspace/api-zod';
import { getOpenAIClient } from '@workspace/integrations-openai-ai-server';
import { ObjectStorageService } from '../lib/objectStorage';
import { PRESENTER_PASSWORD as ADMIN_PASSWORD } from '../lib/presenterAuth';

const objectStorageService = new ObjectStorageService();
const router: IRouter = Router();

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function randomizeQuestions(rawQuestions: QuizQuestion[]): QuizQuestion[] {
  const targetPositions = shuffle(Array.from({ length: 20 }, (_, index) => index % 4));

  return rawQuestions.map((question, questionIndex) => {
    const correctAnswer = question.options[question.correctIndex];
    const distractors = shuffle(question.options.filter((_, index) => index !== question.correctIndex));
    const options = [...distractors] as string[];
    options.splice(targetPositions[questionIndex], 0, correctAnswer);
    return {
      question: question.question.trim(),
      options: options as [string, string, string, string],
      correctIndex: targetPositions[questionIndex],
    };
  });
}

function parseGeneratedQuestions(content: string): QuizQuestion[] {
  const withoutMarkdown = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(withoutMarkdown) as { questions?: unknown };
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 20) {
    throw new Error('The AI did not return exactly 20 questions.');
  }

  const questions = parsed.questions.map((item, index): QuizQuestion => {
    if (!item || typeof item !== 'object') throw new Error(`Question ${index + 1} is invalid.`);
    const candidate = item as { question?: unknown; options?: unknown; correctIndex?: unknown };
    if (
      typeof candidate.question !== 'string' ||
      !Array.isArray(candidate.options) ||
      candidate.options.length !== 4 ||
      !candidate.options.every(option => typeof option === 'string' && option.trim().length > 0) ||
      typeof candidate.correctIndex !== 'number' ||
      !Number.isInteger(candidate.correctIndex) ||
      candidate.correctIndex < 0 ||
      candidate.correctIndex > 3
    ) {
      throw new Error(`Question ${index + 1} has an invalid structure.`);
    }

    return {
      question: candidate.question,
      options: candidate.options as [string, string, string, string],
      correctIndex: candidate.correctIndex,
    };
  });

  return randomizeQuestions(questions);
}

function toPublicQuiz(quiz: typeof quizzesTable.$inferSelect) {
  return {
    id: quiz.id,
    presentationId: quiz.presentationId,
    status: 'ready' as const,
    questions: quiz.questions.map(({ question, options }) => ({ question, options })),
    totalQuestions: quiz.questions.length,
    createdAt: quiz.createdAt,
  };
}

function gradeQuiz(questions: QuizQuestion[], answers: number[]) {
  const score = answers.reduce(
    (total, answer, index) => total + (answer === questions[index]?.correctIndex ? 1 : 0),
    0,
  );
  const review = questions.map((question, index) => ({
    question: question.question,
    options: question.options,
    selectedIndex: answers[index],
    correctIndex: question.correctIndex,
    isCorrect: answers[index] === question.correctIndex,
  }));

  return { score, totalQuestions: questions.length, review };
}

async function extractPdfText(pdfObjectPath: string): Promise<string> {
  const file = await objectStorageService.getObjectEntityFile(pdfObjectPath);
  const [pdfBuffer] = await file.download();
  const runtime = globalThis as Record<string, unknown>;
  if (!runtime.DOMMatrix) {
    class DOMMatrixPolyfill {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
    }
    Object.assign(runtime, {
      DOMMatrix: DOMMatrixPolyfill,
      ImageData: class ImageDataPolyfill {},
      Path2D: class Path2DPolyfill {},
    });
  }

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) throw new Error('No readable text was found in the presentation.');
    return text.slice(0, 100_000);
  } finally {
    await parser.destroy();
  }
}

async function generateQuestionsFromText(text: string): Promise<QuizQuestion[]> {
  const response = await getOpenAIClient().chat.completions.create({
    model: process.env.AI_INTEGRATIONS_OPENAI_MODEL || 'llama-3.3-70b-versatile',
    max_tokens: 12_000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You create accurate educational multiple-choice quizzes from presentation slide text.',
          'Return JSON only with this exact shape: {"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0}]}',
          'Return exactly 20 questions. Every question must have exactly 4 plausible options and one correctIndex from 0 to 3.',
          'Use only facts supported by the slide text. Avoid duplicate questions, trick questions, and questions whose answer is not stated or directly inferable.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Create the quiz from this presentation content:\n\n${text}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('The AI returned an empty quiz.');
  return parseGeneratedQuestions(content);
}

router.get('/presentations/:id/quiz', async (req, res): Promise<void> => {
  // Quiz content is read while a student is actively answering. Avoid
  // conditional 304 responses because the shared client cannot rehydrate a
  // response body from a 304 and React Query would surface it as an error.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const params = GetPresentationQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.presentationId, params.data.id));

  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  res.json(GetPresentationQuizResponse.parse(toPublicQuiz(quiz)));
});

router.post('/presentations/:id/quiz/generate', async (req, res): Promise<void> => {
  const params = GeneratePresentationQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = GeneratePresentationQuizBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  const [presentation] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!presentation) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }
  if (presentation.status !== 'ready' || !presentation.pdfObjectPath) {
    res.status(400).json({ error: 'Presentation is not ready for quiz generation.' });
    return;
  }

  try {
    const text = await extractPdfText(presentation.pdfObjectPath);
    const questions = await generateQuestionsFromText(text);
    const [existingQuiz] = await db
      .select()
      .from(quizzesTable)
      .where(eq(quizzesTable.presentationId, presentation.id));

    const quiz = existingQuiz
      ? (await db
          .delete(quizAttemptsTable)
          .where(eq(quizAttemptsTable.quizId, existingQuiz.id)),
        (await db
          .update(quizzesTable)
          .set({ questions, status: 'ready' })
          .where(eq(quizzesTable.id, existingQuiz.id))
          .returning())[0])
      : (await db
          .insert(quizzesTable)
          .values({
            id: randomUUID(),
            presentationId: presentation.id,
            status: 'ready',
            questions,
          })
          .returning())[0];

    res.json(GeneratePresentationQuizResponse.parse(toPublicQuiz(quiz)));
  } catch (err) {
    req.log.error({ err, presentationId: presentation.id }, 'Failed to generate presentation quiz');
    res.status(500).json({ error: 'Could not generate the quiz. Check that the slides contain readable content and try again.' });
  }
});

router.post('/presentations/:id/quiz/attempts', async (req, res): Promise<void> => {
  const params = SubmitQuizAttemptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitQuizAttemptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.presentationId, params.data.id));

  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  const result = gradeQuiz(quiz.questions, body.data.answers);
  const [attempt] = await db
    .insert(quizAttemptsTable)
    .values({
      id: randomUUID(),
      quizId: quiz.id,
      studentName: body.data.studentName.trim(),
      answers: body.data.answers,
      score: result.score,
      totalQuestions: result.totalQuestions,
    })
    .returning();

  res.status(201).json(SubmitQuizAttemptResponse.parse({
    id: attempt.id,
    quizId: attempt.quizId,
    studentName: attempt.studentName,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    createdAt: attempt.createdAt,
    review: result.review,
  }));
});

router.post('/presentations/:id/quiz/grade', async (req, res): Promise<void> => {
  const params = GradePresentationQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = GradePresentationQuizBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.presentationId, params.data.id));

  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  res.json(GradePresentationQuizResponse.parse(
    gradeQuiz(quiz.questions, body.data.answers),
  ));
});

router.post('/presentations/:id/quiz/results', async (req, res): Promise<void> => {
  const params = GetQuizResultsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = GetQuizResultsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.presentationId, params.data.id));
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  const attempts = await db
    .select()
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.quizId, quiz.id))
    .orderBy(desc(quizAttemptsTable.createdAt));

  res.json(GetQuizResultsResponse.parse(attempts));
});

export default router;