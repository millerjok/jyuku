import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const presentationsTable = pgTable("presentations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileObjectPath: text("file_object_path").notNull(),
  pdfObjectPath: text("pdf_object_path"),
  slideCount: integer("slide_count"),
  currentSlide: integer("current_slide").notNull().default(0),
  maxRevealedSlide: integer("max_revealed_slide").notNull().default(-1),
  contentType: text("content_type").notNull(),
  status: text("status").notNull().default("pending"),
  isPublished: boolean("is_published").notNull().default(false),
  isLive: boolean("is_live").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPresentationSchema = createInsertSchema(presentationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertPresentation = z.infer<typeof insertPresentationSchema>;
export type Presentation = typeof presentationsTable.$inferSelect;
