/**
 * Anthropic API hello-world probe.
 *
 * Purpose: verify that the API key, model access, and the Anthropic SDK are
 * all working BEFORE we touch any app code.
 *
 * If this script fails, the problem is environment setup — not your app.
 * If it succeeds, every later failure is on the app code.
 *
 * Run from server/ with:
 *   npx tsx scripts/test-anthropic.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// Load the same .env the app uses (symlinked from project root)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID || 'claude-haiku-4-5';

async function main() {
  console.log('🔧 Config:');
  console.log(`   Model ID: ${MODEL_ID}`);
  console.log(`   API key:  ${process.env.ANTHROPIC_API_KEY ? 'present' : 'MISSING'}`);
  console.log('');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set. Add it to .env and re-run.');
    process.exit(1);
  }

  // The SDK reads ANTHROPIC_API_KEY from the environment itself.
  const client = new Anthropic();

  try {
    console.log('📡 Sending hello-world to the Anthropic API...');
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
    console.error('❌ Anthropic API call failed.');
    console.error(`   Name:    ${err.name}`);
    console.error(`   Status:  ${err.status ?? 'n/a'}`);
    console.error(`   Message: ${err.message}`);
    console.error('');
    console.error('Common causes:');
    console.error('  • 401 authentication_error → ANTHROPIC_API_KEY is wrong, revoked, or has a stray space.');
    console.error('  • 404 not_found_error → bad model id. Use the alias form, e.g. claude-haiku-4-5');
    console.error('    (the Bedrock form us.anthropic.claude-...-v1:0 is NOT valid here).');
    console.error('  • 400 invalid_request_error → malformed request body; check max_tokens and messages.');
    console.error('  • 429 rate_limit_error → slow down, or check your plan limits in the Console.');
    process.exit(1);
  }
}

main();
