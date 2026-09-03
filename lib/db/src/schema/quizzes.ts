import { jsonb, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { presentationsTable } from "./presentations";

export interface QuizQuestion {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
}

export const quizzesTable = pgTable("quizzes", {
  id: text("id").primaryKey(),
  presentationId: text("presentation_id")
    .notNull()
    .references(() => presentationsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("ready"),
  questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  presentationIdUnique: uniqueIndex("quizzes_presentation_id_unique").on(table.presentationId),
}));

export const quizAttemptsTable = pgTable("quiz_attempts", {
  id: text("id").primaryKey(),
  quizId: text("quiz_id")
    .notNull()
    .references(() => quizzesTable.id, { onDelete: "cascade" }),
  studentName: text("student_name").notNull(),
  answers: jsonb("answers").$type<number[]>().notNull(),
  score: integer("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Quiz = typeof quizzesTable.$inferSelect;
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;