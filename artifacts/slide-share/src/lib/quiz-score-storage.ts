export interface BrowserQuizScore {
  score: number;
  total: number;
  completedAt: string;
}

export type BrowserQuizScores = Record<string, BrowserQuizScore>;

const STORAGE_KEY = 'st-peters-slide-share:quiz-scores:v1';

function isBrowserQuizScore(value: unknown): value is BrowserQuizScore {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<BrowserQuizScore>;
  return (
    Number.isInteger(candidate.score)
    && Number.isInteger(candidate.total)
    && (candidate.total ?? 0) > 0
    && (candidate.score ?? -1) >= 0
    && (candidate.score ?? 0) <= (candidate.total ?? 0)
    && typeof candidate.completedAt === 'string'
  );
}

export function readBrowserQuizScores(): BrowserQuizScores {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, BrowserQuizScore] => (
          entry[0].length > 0 && isBrowserQuizScore(entry[1])
        ),
      ),
    );
  } catch {
    return {};
  }
}

export function saveBrowserQuizScore(
  presentationId: string,
  score: number,
  total: number,
): boolean {
  if (
    typeof window === 'undefined'
    || !presentationId
    || !Number.isInteger(score)
    || !Number.isInteger(total)
    || total <= 0
    || score < 0
    || score > total
  ) {
    return false;
  }

  try {
    const scores = readBrowserQuizScores();
    scores[presentationId] = {
      score,
      total,
      completedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    return true;
  } catch {
    return false;
  }
}