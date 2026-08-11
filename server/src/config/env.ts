// -------------------------------------------------------
// Environment Configuration
// -------------------------------------------------------
// Centralizes all environment variables into a typed
// config object. Every part of the app imports from
// here instead of reading process.env directly.
// -------------------------------------------------------

import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file (symlinked from project root)
dotenv.config();

// Validate environment variables at startup
const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  // Anthropic API — the SDK reads ANTHROPIC_API_KEY itself; it is declared here
  // only so a missing key is visible at startup rather than at the first chat.
  // Optional so the app still boots for non-AI features without it.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_ID: z.string().default('claude-haiku-4-5'),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),
  TAVILY_API_KEY: z.string().optional(),
  // Google Health OAuth — needed for proactive coach feature
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_HEALTH_WEBHOOK_SECRET: z.string().optional(),

});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
