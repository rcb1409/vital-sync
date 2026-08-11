// -------------------------------------------------------
// Debug: Are dataset run items properly linked?
// -------------------------------------------------------
// Run: npx tsx eval/debug-dataset-runs.ts
// -------------------------------------------------------

import { LangfuseClient } from '@langfuse/client';
import dotenv from 'dotenv';

dotenv.config();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
});

const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
const auth = Buffer.from(
  `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
).toString('base64');

async function get(path: string) {
  const res = await fetch(`${baseUrl}/api/public/${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function debug() {
  console.log('\n🔍 Dataset Run Diagnostic\n');
  console.log('═══════════════════════════════════════════\n');

  // ── 1. List all dataset runs for vitalsync-golden-v1 ────────────────────────
  console.log('📋 Step 1: Fetching dataset runs for vitalsync-golden-v1...\n');

  try {
    const runsData = await get('datasets/vitalsync-golden-v1/runs');
    const runs = runsData.data ?? [];
    console.log(`   Found ${runs.length} runs total:\n`);

    for (const run of runs) {
      console.log(`   Run: "${run.name}"`);
      console.log(`     createdAt:  ${run.createdAt}`);
      console.log(`     metadata:   ${JSON.stringify(run.metadata)?.slice(0, 100)}`);
    }

    if (runs.length === 0) {
      console.log('   ❌ NO RUNS FOUND — datasetRunItems.create() may have failed silently');
      console.log('      Check that the LANGFUSE_PUBLIC_KEY / SECRET_KEY are set correctly');
      return;
    }

    // ── 2. Check the most recent run's items ──────────────────────────────────
    const latestRun = runs[0]; // API returns newest first
    console.log(`\n📎 Step 2: Checking items in latest run "${latestRun.name}"...\n`);

    const runItemsData = await get(
      `datasets/vitalsync-golden-v1/runs/${encodeURIComponent(latestRun.name)}`
    );
    const runItems = runItemsData.datasetRunItems ?? [];
    console.log(`   Total items in this run: ${runItems.length}`);

    if (runItems.length === 0) {
      console.log('   ❌ Run exists but has NO items linked');
      console.log('      The run was created but traceIds were not linked to dataset items');
    } else {
      // Sample the first 3 items
      console.log('\n   First 3 items:');
      for (const item of runItems.slice(0, 3)) {
        console.log(`\n   ── datasetItemId: ${item.datasetItemId}`);
        console.log(`      traceId:        ${item.traceId}`);
        console.log(`      observationId:  ${item.observationId ?? '(none)'}`);

        // ── 3. Verify the linked trace actually exists in Langfuse ─────────────
        if (item.traceId) {
          try {
            const traceData = await get(`trace/${item.traceId}`);
            console.log(`      ✅ Trace EXISTS in Langfuse`);
            console.log(`         name:   ${traceData.name}`);
            console.log(`         input:  ${JSON.stringify(traceData.input)?.slice(0, 80)}`);
            console.log(`         output: ${JSON.stringify(traceData.output)?.slice(0, 80)}`);

            // ── 4. Check observations on this trace ─────────────────────────────
            const obsData = await get(`observations?traceId=${item.traceId}&limit=20`);
            const observations = obsData.data ?? [];
            const finalGeneration = observations.find((o: any) =>
              o.name === 'eval-coach-final-reply' || o.name === 'coach-final-reply' || o.name?.startsWith('bedrock-agent-turn')
            );

            if (finalGeneration) {
              console.log(`\n         Final generation observation:`);
              console.log(`           name:     ${finalGeneration.name}`);
              console.log(`           type:     ${finalGeneration.type}`);
              console.log(`           input:    ${JSON.stringify(finalGeneration.input)?.slice(0, 80)}`);
              console.log(`           output:   ${JSON.stringify(finalGeneration.output)?.slice(0, 80)}`);
              console.log(`           metadata: ${JSON.stringify(finalGeneration.metadata)?.slice(0, 150)}`);
              const hasDynamicContext = finalGeneration.metadata?.dynamicContext;
              console.log(`           dynamicContext present: ${hasDynamicContext ? '✅ YES' : '❌ NO'}`);
            } else {
              console.log(`\n         ⚠️  No matching generation observation found`);
              console.log(`            Observations on trace: ${observations.map((o: any) => o.name).join(', ')}`);
            }

          } catch (err) {
            console.log(`      ❌ Trace NOT FOUND in Langfuse: ${(err as Error).message}`);
            console.log(`         This means the traceId from OTEL doesn't match Langfuse's traceId`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`   ❌ Error fetching dataset runs: ${(err as Error).message}`);
  }

  // ── 5. Check evaluator configs and their target ──────────────────────────────
  console.log('\n\n═══════════════════════════════════════════');
  console.log('🧪 Step 3: Evaluator configurations...\n');

  try {
    const evalData = await get('v2/evaluator-configs');
    const configs = evalData.data ?? [];
    console.log(`   Found ${configs.length} evaluator configs:\n`);
    for (const ev of configs) {
      console.log(`   ── ${ev.evalTemplateName || ev.name}`);
      console.log(`      status:       ${ev.status}`);
      console.log(`      targetObject: ${ev.targetObject}`);   // 'trace' | 'observation' | 'dataset_run_item'
      console.log(`      filter:       ${JSON.stringify(ev.filter)?.slice(0, 200)}`);
      console.log(`      variable map: ${JSON.stringify(ev.variableMapping)?.slice(0, 300)}`);
    }
  } catch (err) {
    console.log(`   Could not fetch evaluator configs: ${(err as Error).message}`);
  }

  console.log('\n═══════════════════════════════════════════\n');
}

debug().catch(console.error);
