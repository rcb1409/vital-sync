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
  STRAVA_CLIENT_ID: z.string(),
  STRAVA_CLIENT_SECRET: z.string(),
  // AWS Bedrock — credentials come from the standard AWS chain (CLI / env / IAM role).
  // We only configure region + model ID here.
  AWS_REGION: z.string().default('us-east-1'),
  BEDROCK_MODEL_ID: z.string().default('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),
  TAVILY_API_KEY: z.string().optional(),

});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
