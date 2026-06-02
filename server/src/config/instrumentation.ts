/**
 * OpenTelemetry + Langfuse instrumentation bootstrap.
 *
 * Must be imported at the VERY TOP of the app entry point (index.ts)
 * before any other module that performs tracing, so the OTEL NodeSDK
 * is registered as the global trace provider first.
 *
 * Replaces the old `new Langfuse({ ... })` singleton for tracing.
 * Tracing is now handled by OTEL spans routed through LangfuseSpanProcessor.
 * Prompt management and scoring use `LangfuseClient` from `@langfuse/client`
 * (see langfuse.ts).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { env } from './env';

let sdk: NodeSDK | null = null;

if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
  sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_BASE_URL,
      }),
    ],
  });
  sdk.start();
  console.log('✅ Langfuse OTEL SDK started');

  // Graceful shutdown: flush pending spans before the process exits
  process.on('SIGTERM', () => sdk?.shutdown());
  process.on('SIGINT', () => sdk?.shutdown());
} else {
  console.warn('⚠️  Langfuse keys not set — OTEL tracing disabled');
}

export { sdk as otelSdk };
