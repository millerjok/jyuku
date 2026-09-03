import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

/**
 * Lazily constructs the OpenAI client on first use, so importing this
 * package doesn't crash a server that never calls an AI feature and hasn't
 * configured OpenAI credentials.
 */
export function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient;

  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set to use AI features.",
    );
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set to use AI features.",
    );
  }

  cachedClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return cachedClient;
}
