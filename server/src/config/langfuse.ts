import { LangfuseClient } from '@langfuse/client';
import { env } from './env';

/**
 * Langfuse client — initialized once at startup, shared across the app.
 *
 * In the v5 SDK, `LangfuseClient` handles ONLY non-tracing features:
 *   - Prompt management (`langfuseClient.prompt.get / .create`)
 *   - Scoring (`langfuseClient.score.create`)
 *
 * Tracing is now handled by the OTEL `LangfuseSpanProcessor` in
 * `instrumentation.ts` — it runs in the background and adds zero latency.
 *
 * If keys are missing (e.g. in test environments), we export null
 * and every call site must handle that gracefully.
 */
export const langfuseClient = env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
  ? new LangfuseClient({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
    })
  : null;

if (langfuseClient) {
  console.log('✅ LangfuseClient initialized (prompts + scoring)');
} else {
  console.warn('⚠️  Langfuse keys not set — prompt management disabled');
}
