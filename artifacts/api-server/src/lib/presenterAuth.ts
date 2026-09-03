// Shared presenter/admin password, checked by presentations.ts and
// quizzes.ts. Overridable via env so a public deploy isn't stuck with the
// password that ships in this open-source repo.
export const PRESENTER_PASSWORD = process.env.PRESENTER_PASSWORD || 'zoe123';
