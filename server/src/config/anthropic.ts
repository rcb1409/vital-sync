import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

/**
 * Anthropic API client — initialized once at startup, shared across the app.
 *
 * The key is read from ANTHROPIC_API_KEY by the SDK itself; we never pass it
 * through code. Previously this was AnthropicBedrock, which resolved AWS
 * credentials from the provider chain — the message API is identical, so the
 * only thing that changed is how the client authenticates and the model ID
 * format (`us.anthropic.claude-haiku-4-5-20251001-v1:0` → `claude-haiku-4-5`).
 */
export const anthropic = new Anthropic();

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY is not set — every model call will fail with a 401.');
} else {
  console.log(`✅ Anthropic client ready (model=${env.ANTHROPIC_MODEL_ID})`);
}
