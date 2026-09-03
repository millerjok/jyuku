import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Home, Loader2, XCircle } from 'lucide-react';
import { getGetPresentationQueryKey, getGetPresentationQuizQueryKey, useGetPresentation, useGetPresentationQuiz, useSubmitQuizAttempt } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLogo } from '@/components/brand-logo';
import { saveBrowserQuizScore } from '@/lib/quiz-score-storage';

const GRACE_PERIOD_MS = 10_000;

const FIREWORK_PARTICLES = Array.from({ length: 12 }, (_, index) => index * 30);
const FIREWORK_BURSTS = [
  { left: 16, top: 24, delay: 0, color: '#f0d875' },
  { left: 83, top: 22, delay: 0.7, color: '#e8799b' },
  { left: 28, top: 70, delay: 1.25, color: '#8bd3dd' },
  { left: 74, top: 68, delay: 0.35, color: '#f7a35c' },
];

function Fireworks() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {FIREWORK_BURSTS.map((burst, burstIndex) => (
        <div
          key={`${burst.left}-${burst.top}`}
          className="firework-burst"
          style={{
            left: `${burst.left}%`,
            top: `${burst.top}%`,
            '--firework-delay': `${burst.delay}s`,
            '--firework-color': burst.color,
          } as React.CSSProperties}
        >
          <span className="firework-core" />
          {FIREWORK_PARTICLES.map(angle => (
            <span
              key={`${burstIndex}-${angle}`}
              className="firework-spark"
              style={{ '--firework-angle': `${angle}deg` } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function QuizPage() {
  const [, params] = useRoute('/quiz/:id');
  const [, setLocation] = useLocation();
  const id = params?.id ?? '';
  const { data: presentation } = useGetPresentation(id, { query: { enabled: !!id, queryKey: getGetPresentationQueryKey(id) } });
  const { data: quiz, isLoading } = useGetPresentationQuiz(id, {
    query: {
      enabled: !!id,
      queryKey: getGetPresentationQuizQueryKey(id),
      retry: false,
    },
  });
  const { mutateAsync: submitQuizAttempt, isPending: isSubmitting } = useSubmitQuizAttempt();

  const [studentName, setStudentName] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [score, setScore] = useState<{
    value: number;
    total: number;
    review: Array<{
      question: string;
      options: string[];
      selectedIndex: number;
      correctIndex: number;
      isCorrect: boolean;
    }>;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [quizTerminated, setQuizTerminated] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mid-quiz only: not before the student has started, and not once it's
  // been submitted (score set) — reviewing results is fine outside fullscreen.
  const isAttemptActive = hasStarted && !score;

  // Anti-cheating: leaving fullscreen OR switching away from the tab
  // (alt-tab, minimizing — detected via the Page Visibility API) while a
  // quiz attempt is active starts a 10s grace-period countdown. Coming
  // fully back (fullscreen restored AND the tab visible again) before it
  // expires cancels the countdown and the attempt continues normally;
  // otherwise the attempt ends when time runs out.
  const [graceDeadline, setGraceDeadline] = useState<number | null>(null);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(0);

  const terminateQuiz = useCallback(() => {
    setGraceDeadline(null);
    setHasStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setQuizTerminated(true);
  }, []);

  useEffect(() => {
    if (!isAttemptActive) return;

    const hasLeft = () => !document.fullscreenElement || document.hidden;

    const handlePotentialExit = () => {
      if (!hasLeft()) {
        setGraceDeadline(null);
        return;
      }
      // Only start the countdown once per departure — repeated events
      // (fullscreenchange + visibilitychange can both fire) shouldn't
      // reset an already-running grace period.
      setGraceDeadline(current => current ?? Date.now() + GRACE_PERIOD_MS);
      // Best-effort: browsers generally block a requestFullscreen() call
      // that isn't triggered by a fresh user gesture, so this may no-op.
      void containerRef.current?.requestFullscreen().catch(() => {});
    };

    document.addEventListener('fullscreenchange', handlePotentialExit);
    document.addEventListener('visibilitychange', handlePotentialExit);
    return () => {
      document.removeEventListener('fullscreenchange', handlePotentialExit);
      document.removeEventListener('visibilitychange', handlePotentialExit);
    };
  }, [isAttemptActive]);

  useEffect(() => {
    if (graceDeadline === null) return;

    const tick = () => {
      const remainingMs = graceDeadline - Date.now();
      if (remainingMs <= 0) {
        terminateQuiz();
        return;
      }
      setGraceSecondsLeft(Math.ceil(remainingMs / 1000));
    };

    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [graceDeadline, terminateQuiz]);

  const playTone = useCallback((frequency: number, duration: number, startDelay = 0, volume = 0.05) => {
    if (typeof window === 'undefined') return;

    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const audioContext = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = audioContext;
    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startTime = audioContext.currentTime + startDelay;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }, []);

  const playNextSound = useCallback(() => {
    playTone(660, 0.1, 0, 0.045);
  }, [playTone]);

  const playCongratsSound = useCallback(() => {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      playTone(frequency, 0.18, index * 0.11, 0.06);
    });
  }, [playTone]);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  const startQuiz = (event: React.FormEvent) => {
    event.preventDefault();
    if (!studentName.trim() || !quiz) return;
    setAnswers(Array.from({ length: quiz.questions.length }, () => -1));
    setQuizTerminated(false);
    setHasStarted(true);
    // This click is a genuine user gesture, so the browser allows it.
    void containerRef.current?.requestFullscreen().catch(() => {});
  };

  const chooseAnswer = (answerIndex: number) => {
    setAnswers(previous => {
      const next = [...previous];
      next[currentQuestion] = answerIndex;
      return next;
    });
  };

  const submitQuiz = async () => {
    if (!quiz || answers.some(answer => answer < 0)) return;
    setSubmitError(null);
    setStorageWarning(null);
    try {
      const result = await submitQuizAttempt({
        id,
        data: { studentName: studentName.trim(), answers },
      });
      const scoreWasSaved = saveBrowserQuizScore(id, result.score, result.totalQuestions);
      if (!scoreWasSaved) {
        setStorageWarning('Your result was recorded, but this browser could not save its local progress badge.');
      }
      playCongratsSound();
      setScore({ value: result.score, total: result.totalQuestions, review: result.review });
    } catch (submitErr) {
      console.error('Failed to submit quiz', submitErr);
      setSubmitError('Your quiz could not be graded. Please try submitting again.');
    }
  };

  const question = quiz?.questions[currentQuestion];
  const isLastQuestion = !!quiz && currentQuestion === quiz.questions.length - 1;
  const hasAnswer = (answers[currentQuestion] ?? -1) >= 0;
  const goToNextQuestion = useCallback(() => {
    if (!quiz) return;
    playNextSound();
    setCurrentQuestion(questionIndex => Math.min(quiz.questions.length - 1, questionIndex + 1));
  }, [playNextSound, quiz]);

  return (
    <div ref={containerRef} className="min-h-screen bg-background text-foreground">
      {graceDeadline !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center text-white">
          <p className="text-2xl font-bold">You left the quiz view</p>
          <p className="max-w-sm text-white/80">
            Return to fullscreen on this tab or your attempt will end automatically.
          </p>
          <p className="font-mono text-6xl font-bold text-[#f0d875]" aria-live="assertive">
            {graceSecondsLeft}
          </p>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-[#d8bf5e]/50 bg-[#843b49]">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-md text-[#fff8df] transition-colors hover:text-[#f0d875]" aria-label="Return to homepage">
              <Home className="h-5 w-5" />
            </Link>
            <BrandLogo compact />
            <div className="hidden border-l border-[#fff8df]/20 pl-3 sm:block">
              <p className="text-xs uppercase tracking-widest text-[#f0d875]">Knowledge check</p>
              <p className="max-w-[42vw] truncate text-sm font-semibold text-[#fff8df]">
                {presentation?.title ?? 'Presentation quiz'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocation('/')} className="gap-1.5 text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]">
            <Home className="h-4 w-4" />
            Homepage
          </Button>
        </div>
      </header>

      <main className="container mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center px-6 py-12">
        {isLoading && !quiz ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p>Loading quiz...</p>
          </div>
        ) : !quiz ? (
          <Card className="w-full max-w-lg border-border/50 bg-card/70 text-center shadow-xl">
            <CardHeader>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <ClipboardCheck className="h-7 w-7 text-primary" />
              </div>
              <CardTitle className="text-2xl">Quiz not available yet</CardTitle>
              <CardDescription>
                The admin has not created a quiz for this presentation. Please check back later.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setLocation('/')} className="gap-2">
                <Home className="h-4 w-4" />
                Return to homepage
              </Button>
            </CardContent>
          </Card>
        ) : score ? (
          <div className="w-full max-w-3xl space-y-6">
            <Card className="relative w-full overflow-hidden border-[#d8bf5e]/40 bg-card/80 text-center shadow-2xl">
              {score.value >= 18 && <Fireworks />}
              <div className="relative z-10">
                <div className="h-2 bg-[#f0d875]" />
                <CardHeader className="pt-10">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/15">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <Badge className="mx-auto mt-5 w-fit bg-[#843b49] text-[#fff8df]">{studentName.trim()}</Badge>
                  <CardTitle className="mt-2 text-3xl">Quiz complete</CardTitle>
                  <CardDescription>
                    {score.value >= 18 ? 'Outstanding work!' : presentation?.title}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-10">
                  <p className="font-mono text-6xl font-bold text-[#843b49]">{score.value}/{score.total}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {Math.round((score.value / score.total) * 100)}% correct
                  </p>
                   <p className={`mt-3 text-xs ${storageWarning ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {storageWarning ?? 'Your result has been recorded for the course administrator.'}
                   </p>
                </CardContent>
              </div>
            </Card>

            <Card className="border-[#d8bf5e]/40 bg-card/80 shadow-xl">
              <CardHeader>
                <CardTitle className="text-2xl">Review your answers</CardTitle>
                <CardDescription>
                  Green answers are correct. For any incorrect answer, the correct answer is shown underneath.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {score.review.map((item, index) => (
                  <div
                    key={`${item.question}-${index}`}
                    className={`rounded-xl border p-4 ${
                      item.isCorrect
                        ? 'border-green-600/30 bg-green-500/5'
                        : 'border-red-600/30 bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {item.isCorrect ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0 flex-1 space-y-3">
                        <p className="font-semibold leading-snug">
                          <span className="mr-2 text-muted-foreground">{index + 1}.</span>
                          {item.question}
                        </p>
                        <div className="grid gap-2 text-sm">
                          <div className={`rounded-lg border px-3 py-2 ${
                            item.isCorrect
                              ? 'border-green-600/30 bg-green-500/10'
                              : 'border-red-600/30 bg-red-500/10'
                          }`}>
                            <span className="mr-2 font-semibold">Your answer:</span>
                            {item.options[item.selectedIndex]}
                          </div>
                          {!item.isCorrect && (
                            <div className="rounded-lg border border-green-600/30 bg-green-500/10 px-3 py-2">
                              <span className="mr-2 font-semibold text-green-700">Correct answer:</span>
                              {item.options[item.correctIndex]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex justify-center pb-4">
              <Button onClick={() => setLocation('/')} className="gap-2">
                <Home className="h-4 w-4" />
                Return to homepage
              </Button>
            </div>
          </div>
        ) : !hasStarted ? (
          <Card className="w-full max-w-lg border-[#d8bf5e]/40 bg-card/80 shadow-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#843b49]/10">
                <ClipboardCheck className="h-8 w-8 text-[#843b49]" />
              </div>
              <CardTitle className="mt-2 text-3xl">Ready for the quiz?</CardTitle>
              <CardDescription>
                Test your understanding of <span className="font-semibold text-foreground">{presentation?.title}</span> with 20 multiple-choice questions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {quizTerminated && (
                <p className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                  Your attempt ended because you left the quiz view (exited fullscreen or switched tabs) for too long. Start again and stay in fullscreen on this tab until you submit.
                </p>
              )}
              <form onSubmit={startQuiz} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="student-name">Your name</Label>
                  <Input
                    id="student-name"
                    value={studentName}
                    onChange={event => setStudentName(event.target.value)}
                    placeholder="Type your name to enter"
                    maxLength={80}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    No sign-in needed. Your name and result are shared with the course administrator so they can view quiz results.
                  </p>
                </div>
                <Button type="submit" className="h-11 w-full gap-2" disabled={!studentName.trim()}>
                  Start quiz
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : question ? (
          <Card className="w-full border-[#d8bf5e]/40 bg-card/80 shadow-2xl">
            <CardHeader className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <Badge className="bg-[#843b49] text-[#fff8df]">Question {currentQuestion + 1} of {quiz.questions.length}</Badge>
                <span className="text-sm font-medium text-muted-foreground">{studentName.trim()}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[#f0d875] transition-all"
                  style={{ width: `${((currentQuestion + 1) / quiz.questions.length) * 100}%` }}
                />
              </div>
              <CardTitle className="text-2xl leading-tight">{question.question}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3">
                {question.options.map((option, optionIndex) => {
                  const selected = answers[currentQuestion] === optionIndex;
                  return (
                    <button
                      key={`${option}-${optionIndex}`}
                      type="button"
                      onClick={() => chooseAnswer(optionIndex)}
                      className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-colors ${
                        selected
                          ? 'border-[#843b49] bg-[#843b49]/10 ring-2 ring-[#843b49]/20'
                          : 'border-border/60 bg-background/50 hover:border-[#843b49]/50 hover:bg-[#843b49]/5'
                      }`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                        selected ? 'border-[#843b49] bg-[#843b49] text-[#fff8df]' : 'border-border text-muted-foreground'
                      }`}>
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="pt-1 text-sm font-medium">{option}</span>
                    </button>
                  );
                })}
              </div>
              {submitError && <p className="text-sm font-medium text-destructive">{submitError}</p>}
              <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCurrentQuestion(questionIndex => Math.max(0, questionIndex - 1))}
                  disabled={currentQuestion === 0}
                  className="gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>
                {isLastQuestion ? (
                  <Button type="button" onClick={submitQuiz} disabled={!hasAnswer || isSubmitting} className="gap-1.5">
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Submit quiz
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={goToNextQuestion}
                    disabled={!hasAnswer}
                    className="gap-1.5"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}