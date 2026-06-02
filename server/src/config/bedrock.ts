import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { env } from './env';

/**
 * Anthropic-on-Bedrock client — initialized once at startup, shared across the app.
 *
 * Credentials are read automatically from the standard AWS provider chain:
 *   1. Environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 *   2. Shared config file (~/.aws/credentials, used by `aws configure`)
 *   3. IAM role (when running on EC2 / ECS / Lambda)
 *
 * We only configure region; we never pass the key into code.
 */
export const bedrock = new AnthropicBedrock({ awsRegion: env.AWS_REGION });

console.log(`✅ Bedrock client ready (region=${env.AWS_REGION}, model=${env.BEDROCK_MODEL_ID})`);
