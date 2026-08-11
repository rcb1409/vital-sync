/**
 * One-time seed script: uploads VitalSync's three system prompts to Langfuse.
 *
 * Usage:
 *   npm run seed:prompts
 *
 * What it does:
 *   - Reads persona.md, safety.md, tools.md from src/services/ai/prompts/
 *   - Creates (or appends a new version to) three Langfuse prompts:
 *       • vitalsync-persona
 *       • vitalsync-safety
 *       • vitalsync-tools
 *   - Labels each new version `production` so the runtime fetcher picks it up.
 *
 * Re-running this script is safe: Langfuse versions prompts automatically.
 * If the .md content is unchanged, you'll see a new version with identical text.
 * Edit prompts in the Langfuse UI for ongoing changes — this script is only
 * meant to bootstrap initial content from the existing .md files.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { langfuseClient } from '../src/config/langfuse';

const PROMPTS_DIR = path.join(__dirname, '..', 'src', 'services', 'ai', 'prompts');

const PROMPTS_TO_SEED = [
  { name: 'vitalsync-persona', file: 'persona.md' },
  { name: 'vitalsync-safety', file: 'safety.md' },
  { name: 'vitalsync-tools', file: 'tools.md' },
];

async function main() {
  if (!langfuseClient) {
    console.error('❌ Langfuse client not initialized. Check LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in .env');
    process.exit(1);
  }

  for (const { name, file } of PROMPTS_TO_SEED) {
    const filePath = path.join(PROMPTS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Skipping ${name}: ${filePath} not found`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8').trim();

    try {
      const created = await langfuseClient.prompt.create({
        name,
        prompt: content,
        labels: ['production'],
        type: 'text',
      });
      console.log(`✅ Uploaded ${name} (version ${created.version}) — labeled 'production'`);
    } catch (err) {
      console.error(`❌ Failed to upload ${name}:`, (err as Error).message);
    }
  }

  // LangfuseClient in v5 does not require explicit shutdown —
  // HTTP requests are completed synchronously via await above.
  console.log('\nDone. Visit your Langfuse dashboard → Prompts to view/edit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
