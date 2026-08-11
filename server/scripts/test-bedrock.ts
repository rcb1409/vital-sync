/**
 * Bedrock hello-world probe.
 *
 * Purpose: verify that AWS credentials, region, model access, and the
 * Anthropic Bedrock SDK are all working BEFORE we touch any app code.
 *
 * If this script fails, the problem is environment setup — not your app.
 * If it succeeds, every later failure is on the migration code.
 *
 * Run from server/ with:
 *   npx tsx scripts/test-bedrock.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';

// Load the same .env the app uses (symlinked from project root)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  'anthropic.claude-haiku-4-5-20251001-v1:0';

async function main() {
  console.log('🔧 Config:');
  console.log(`   Region:   ${REGION}`);
  console.log(`   Model ID: ${MODEL_ID}`);
  console.log('');

  // Credentials are read automatically from the standard AWS chain:
  //   1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
  //   2. Shared config (~/.aws/credentials)
  //   3. IAM role (when running on EC2/ECS/Lambda)
  // Since you have AWS CLI configured, option 2 will be used.
  const client = new AnthropicBedrock({ awsRegion: REGION });

  try {
    console.log('📡 Sending hello-world to Bedrock...');
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 64,
      messages: [
        { role: 'user', content: 'Say hello in one short sentence.' },
      ],
    });

    // Anthropic responses are an array of "content blocks". For a plain
    // text reply there will be exactly one block of type "text".
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '(no text block)';

    console.log('');
    console.log('✅ Success!');
    console.log(`   Model:        ${response.model}`);
    console.log(`   Stop reason:  ${response.stop_reason}`);
    console.log(`   Input tokens: ${response.usage.input_tokens}`);
    console.log(`   Output tokens:${response.usage.output_tokens}`);
    console.log(`   Reply:        ${text}`);
  } catch (err: any) {
    console.error('');
    console.error('❌ Bedrock call failed.');
    console.error(`   Name:    ${err.name}`);
    console.error(`   Status:  ${err.status ?? 'n/a'}`);
    console.error(`   Message: ${err.message}`);
    console.error('');
    console.error('Common causes:');
    console.error('  • AccessDeniedException → Haiku 4.5 not enabled in Bedrock console for this region.');
    console.error('  • ValidationException with "inference profile" → switch BEDROCK_MODEL_ID to the prefixed form,');
    console.error('    e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0');
    console.error('  • UnrecognizedClientException / InvalidSignatureException → AWS creds not picked up.');
    console.error('    Run `aws sts get-caller-identity` to confirm CLI creds work.');
    console.error('  • Region mismatch → ensure your CLI region matches AWS_REGION above.');
    process.exit(1);
  }
}

main();
