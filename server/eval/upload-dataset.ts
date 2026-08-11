// -------------------------------------------------------
// Dataset Upload Script (run once, or when cases change)
// -------------------------------------------------------
// Pushes the golden dataset from our local golden-v1.ts
// into Langfuse's Datasets feature so the eval runner
// can fetch them from Langfuse instead of reading locally.
//
// WHY store in Langfuse and not just read the local file?
//   - Dataset items are visible in the Langfuse UI
//   - Each run is linked to specific dataset items → you
//     can click any score and see exactly which question
//     caused a failure
//   - Langfuse's LLM-as-judge evaluator needs dataset items
//     to link against in order to auto-score them
//
// Run with:
//   npx tsx eval/upload-dataset.ts
//
// Safe to re-run — it upserts (skips items that already exist
// with the same externalId).
// -------------------------------------------------------

import { LangfuseClient } from '@langfuse/client';
import dotenv from 'dotenv';
import { goldenDataset, datasetStats } from './datasets/golden-v1';
import { EVAL_CONFIG } from './config';

dotenv.config();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
});

// Single source of truth — the runner reads the same name from config.ts.
const DATASET_NAME = EVAL_CONFIG.datasetName;

async function uploadDataset() {
  console.log('📤 Uploading golden dataset to Langfuse...\n');
  console.log(`   Dataset:  ${DATASET_NAME}`);
  console.log(`   Cases:    ${datasetStats.total} total`);
  console.log(`   Tiers:    basic=${datasetStats.byTier.basic}, tool_selection=${datasetStats.byTier.tool_selection}, safety=${datasetStats.byTier.safety}, multi_step=${datasetStats.byTier.multi_step}, edge_case=${datasetStats.byTier.edge_case}\n`);

  // Step 1: Create the dataset in Langfuse (idempotent — safe to call again)
  await langfuse.api.datasets.create({
    name: DATASET_NAME,
    description: 'Golden evaluation dataset for VitalSync AI coach — tests basic coaching, tool selection, safety guardrails, multi-step reasoning, and edge cases.',
    metadata: {
      version: 'v2',
      totalCases: datasetStats.total,
      tiers: datasetStats.byTier,
    },
  });

  console.log(`   ✅ Dataset created/confirmed in Langfuse\n`);

  // Step 2: Upload each case as a dataset item
  let uploaded = 0;
  let skipped = 0;

  for (const evalCase of goldenDataset) {
    try {
      await langfuse.api.datasetItems.create({
        datasetName: DATASET_NAME,

        // Stable, deterministic id → Langfuse UPSERTS on this key. Re-running
        // the upload updates the existing item instead of appending a duplicate.
        // (The previous version omitted this, which is how v1 accumulated 3x
        //  copies of every case.) Namespaced by dataset so ids never collide
        //  across versions.
        id: `${DATASET_NAME}::${evalCase.id}`,

        // The input is what gets sent to chatWithCoach
        input: {
          message: evalCase.message,
        },

        // expectedOutput: plain string so LLM-as-judge can read it directly
        // without having to unwrap a JSON object.
        expectedOutput: evalCase.expectedBehavior,

        // Metadata: tier, assertions, and the case ID for easy lookup
        // The eval runner uses assertions to run deterministic checks
        metadata: {
          id: evalCase.id,
          tier: evalCase.tier,
          assertions: evalCase.assertions,
          context: evalCase.context || 'default',
        },
      });

      console.log(`   ✅ ${evalCase.id} (${evalCase.tier})`);
      uploaded++;
    } catch (err) {
      console.warn(`   ⚠️  ${evalCase.id} — upload failed:`, (err as Error).message);
      skipped++;
    }
  }

  // v5 LangfuseClient uses synchronous HTTP — no flush needed

  // Summary
  console.log('\n─────────────────────────────────────');
  console.log(`✅ Upload complete`);
  console.log(`   Uploaded: ${uploaded} items`);
  if (skipped > 0) console.log(`   Skipped:  ${skipped} items (check warnings above)`);
  console.log(`\n   View in Langfuse: Datasets → ${DATASET_NAME}`);
  console.log('─────────────────────────────────────\n');
}

uploadDataset().catch((err) => {
  console.error('❌ Upload failed:', err);
  process.exit(1);
});
