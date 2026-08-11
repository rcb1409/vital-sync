// -------------------------------------------------------
// Eval Runner
// -------------------------------------------------------
// Fetches the golden dataset from Langfuse, runs each case
// against chatWithCoach, links the resulting trace to the
// dataset item, and pushes deterministic scores back.
//
// The LLM-as-judge scores are handled automatically by
// Langfuse's evaluator (configured once in the UI).
//
// Run with:
//   npx tsx eval/runner.ts
//
// Prerequisites:
//   1. npx prisma db seed         (exercise library)
//   2. npx tsx eval/seed-eval-user.ts   (eval user)
//   3. npx tsx eval/upload-dataset.ts   (dataset in Langfuse)
//   4. Server does NOT need to be running — we call chatWithCoach directly
// -------------------------------------------------------

import '../src/config/instrumentation'; // Must be first to start OTEL NodeSDK
import { otelSdk } from '../src/config/instrumentation';
import { trace } from '@opentelemetry/api';
import { LangfuseClient } from '@langfuse/client';
import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { aiService } from '../src/services/ai.service';
import { EVAL_CONFIG, getRunMetadata } from './config';
import { EVAL_CONTEXT_DEFAULT, EVAL_CONTEXT_DEFICIT, EVAL_CONTEXT_EMPTY } from './fixtures/context';
import type { EvalAssertion, EvalCase } from './datasets/golden-v1';
import { judgeCorrectness, judgeHallucination, judgeHelpfulness, judgeOutOfScope } from './judges';

// ── Context fixture resolver ─────────────────────────────────────────────────
// Each eval case can optionally specify which context fixture to use.
// Default is the standard mid-day user with 940 cal, 1 workout, etc.
function resolveContext(contextKey?: string): string {
  switch (contextKey) {
    case 'deficit': return EVAL_CONTEXT_DEFICIT;
    case 'empty':   return EVAL_CONTEXT_EMPTY;
    default:        return EVAL_CONTEXT_DEFAULT;
  }
}

// ── LLM-as-judge plan ──────────────────────────────────────────────────────
// We run the judges in CODE here (not via Langfuse UI evaluator rules, which
// are pinned to a dataset id and silently stop firing on version bumps).
// Scores are pushed to Langfuse via langfuse.score.create — same mechanism as
// the deterministic scores — so they still show up in the Experiments UI.
//
// Which judges run on which tier (keeps cost sane + signal relevant):
//   correctness   → every case (scores the response against expectedBehavior)
//   helpfulness   → every non-edge case
//   hallucination → basic / tool_selection / multi_step (where grounding matters)
//   out_of_scope  → edge_case only
// NOTE on direction: correctness/helpfulness/out_of_scope → 1 is GOOD.
//                    hallucination → 0 is GOOD (1 = fabricated facts).
type JudgeScore = { name: string; value: number; comment: string };

async function runJudges(
  tier: string,
  message: string,
  reply: string,
  context: string,
  expectedBehavior: string,
): Promise<JudgeScore[]> {
  const safe = async (name: string, fn: () => Promise<{ score: number; reasoning: string }>): Promise<JudgeScore | null> => {
    try {
      const r = await fn();
      return { name, value: r.score, comment: r.reasoning };
    } catch (err) {
      console.warn(`     ⚠️ judge "${name}" failed: ${(err as Error).message}`);
      return null;
    }
  };

  const jobs: Promise<JudgeScore | null>[] = [
    safe('judge_correctness', () => judgeCorrectness(message, reply, expectedBehavior)),
  ];
  if (tier !== 'edge_case') {
    jobs.push(safe('judge_helpfulness', () => judgeHelpfulness(message, reply)));
  }
  if (tier === 'basic' || tier === 'tool_selection' || tier === 'multi_step') {
    jobs.push(safe('judge_hallucination', () => judgeHallucination(message, reply, context)));
  }
  if (tier === 'edge_case') {
    jobs.push(safe('judge_out_of_scope', () => judgeOutOfScope(message, reply)));
  }

  const results = await Promise.all(jobs);
  return results.filter((r): r is JudgeScore => r !== null);
}

dotenv.config();

// -------------------------------------------------------
// Clients
// -------------------------------------------------------
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
});

// -------------------------------------------------------
// Deterministic assertion checker
// -------------------------------------------------------
// Checks the coach's response + tool calls against the
// assertions defined in the golden dataset item.
// Returns a breakdown of which checks passed/failed.
//
// WHY deterministic first, LLM judge second?
//   Deterministic checks are instant and free. They catch
//   obvious failures (wrong tool, missing safety word) without
//   needing an LLM call. The judge handles nuanced quality.
// -------------------------------------------------------
interface AssertionResult {
  toolMustCallPass: boolean;       // All required tools were called
  toolMustNotCallPass: boolean;    // No forbidden tools were called
  overallPass: boolean;            // Both tool checks passed

  // Details for debugging failed cases
  missingTools: string[];
  forbiddenToolsCalled: string[];
}

// Deterministic checks are TOOL-CALLS-ONLY. Whether the response text is
// correct/safe/grounded is a semantic judgment delegated to the LLM judge —
// substring matching can't distinguish "recommend peanuts" from "warn about
// peanuts", so it has no place here.
function checkAssertions(
  assertions: EvalAssertion,
  toolsCalled: string[]
): AssertionResult {
  // Check 1: Tools that MUST have been called
  const missingTools = (assertions.toolsMustCall || []).filter(
    (t) => !toolsCalled.includes(t)
  );

  // Check 2: Tools that must NOT have been called
  const forbiddenToolsCalled = (assertions.toolsMustNotCall || []).filter(
    (t) => toolsCalled.includes(t)
  );

  const toolMustCallPass = missingTools.length === 0;
  const toolMustNotCallPass = forbiddenToolsCalled.length === 0;

  return {
    toolMustCallPass,
    toolMustNotCallPass,
    overallPass: toolMustCallPass && toolMustNotCallPass,
    missingTools,
    forbiddenToolsCalled,
  };
}

// -------------------------------------------------------
// Main runner
// -------------------------------------------------------
async function runEval() {
  console.log('\n🧪 VitalSync Eval Runner\n');
  console.log('═══════════════════════════════════════════\n');

  // Step 1: Get the eval user from the DB
  const evalUser = await prisma.user.findUnique({
    where: { email: EVAL_CONFIG.evalUserEmail },
    select: { id: true, email: true },
  });

  if (!evalUser) {
    console.error(`❌ Eval user not found: ${EVAL_CONFIG.evalUserEmail}`);
    console.error('   Run: npx tsx eval/seed-eval-user.ts');
    process.exit(1);
  }

  console.log(`👤 Eval user: ${evalUser.email} (${evalUser.id})\n`);

  // ── Snapshot eval user memory before the run ─────────────────
  // Safety/multi-step cases contain messages like "I have chest pain" which
  // the memory extractor will store as long-term facts, polluting future runs.
  // We snapshot here and restore after so every run starts with clean memory.
  const memorySnapshotRow = await prisma.user.findUnique({
    where: { id: evalUser.id },
    select: { aiMemory: true },
  });
  const originalMemory = memorySnapshotRow?.aiMemory ?? null;
  console.log('💾 Memory snapshot saved (will restore after run)\n');

  // Step 2: Fetch the golden dataset from Langfuse
  console.log(`📋 Fetching dataset: ${EVAL_CONFIG.datasetName}`);
  const dataset = await langfuse.dataset.get(EVAL_CONFIG.datasetName);
  const items = dataset.items;
  const datasetId = dataset.id; // CUID — used for langfuse.experiment.dataset.id OTEL attribute
  console.log(`   ${items.length} items loaded  (datasetId: ${datasetId})\n`);

  // Step 3: Name this eval run (timestamp makes each run unique in Langfuse)
  // You can compare runs in the Langfuse Experiments UI using this name
  const runName = `eval-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  console.log(`🏃 Run name: ${runName}\n`);
  console.log('─────────────────────────────────────────\n');

  // Step 4: Counters for the final summary
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    byTier: {} as Record<string, { passed: number; total: number }>,
  };

  // Step 5: Loop through every dataset item and evaluate
  for (const item of items) {
    // Pull the case metadata we stored during upload
    // Cast from {} to our known shapes — we control what was uploaded
    const meta = (item.metadata ?? {}) as { id?: string; tier?: string; assertions?: EvalAssertion; context?: string };
    const inputData = (item.input ?? {}) as { message?: string };

    const caseId: string = meta.id ?? item.id;
    const tier: string = meta.tier ?? 'unknown';
    const assertions: EvalAssertion = meta.assertions ?? {};
    const message: string = inputData.message ?? '';
    const contextFixture = resolveContext(meta.context);

    // Init tier bucket for summary
    if (!summary.byTier[tier]) summary.byTier[tier] = { passed: 0, total: 0 };
    summary.total++;
    summary.byTier[tier].total++;

    process.stdout.write(`  [${caseId}]  `);

    // ── Special case: edge-03 (empty message) ──────────────────
    // This case tests HTTP input validation (returns 400 in production).
    // When calling chatWithCoach directly, the LLM receives an empty
    // string. We skip the LLM call and count it as a structural pass.
    if (message === '') {
      console.log('⏭  SKIP (empty message — tests HTTP validation layer, not LLM)');
      summary.passed++;
      summary.byTier[tier].passed++;

      // For the skipped case we can't link a real trace — just continue
      // (no item.link needed since there's no LLM call)

      continue;
    }

    // ── Run the coach ───────────────────────────────────────────
    // Extract expectedBehavior for this dataset item so it can be
    // attached to the generation's metadata. The Langfuse UI evaluator
    // for correctness reads it from metadata.expectedBehavior.
    const expectedBehavior = ((item.expectedOutput ?? '') as any)?.behavior
      ?? (item.expectedOutput as string)
      ?? '';

    let reply = '';
    let toolsCalled: string[] = [];
    let traceId: string | undefined;
    let dynamicContext = '';

    try {
      const result = await aiService.chatWithCoach(
        evalUser.id,
        message,
        [],
        undefined, // sessionId
        {
          skipMemoryExtraction: true,
          contextOverride: contextFixture,
          expectedBehavior,
          datasetRunName:  runName,
          datasetId,
          datasetItemId:   item.id,
          expectedOutput:  item.expectedOutput,
        },
      );
      reply = result.reply;
      toolsCalled = result.toolsCalled;
      traceId = result.traceId;
      dynamicContext = result.dynamicContext || '';
    } catch (err) {
      console.log(`❌  ERROR — ${(err as Error).message}`);
      summary.errors++;
      continue;
    }

    // ── Link trace to dataset item ──────────────────────────────
    // item.link() needs a LangfuseObjectClient (not just a plain ID).
    // We reconstruct a trace client from the known traceId using the
    // same langfuse instance. Calling langfuse.trace({ id }) with an
    // existing ID is idempotent — it creates a client stub that points
    // to the already-existing trace without creating a duplicate.
    if (traceId) {
      // Force flush OTel spans so they are ingested by Langfuse before we link them.
      // forceFlush() waits for the HTTP delivery to complete — Langfuse has received
      // the spans by this point. The actual root cause of missing scores was the
      // traceId format (OTEL hex vs Langfuse UUID), which is now fixed in ai.service.ts.
      const provider = trace.getTracerProvider();
      if (provider && typeof (provider as any).forceFlush === 'function') {
        await (provider as any).forceFlush();
      }

      await langfuse.api.datasetRunItems.create({
        datasetItemId: item.id,
        traceId: traceId,
        runName,
        metadata: {
          ...EVAL_CONFIG.traceMetadata,
          promptVersion: process.env.PROMPT_VERSION || 'v1.2',
        },
      });
    }

    // ── Run deterministic assertion checks (tools only) ────────
    const result = checkAssertions(assertions, toolsCalled);

    // ── Run the LLM-as-judge evaluators (code-based) ───────────
    const judgeScores = traceId
      ? await runJudges(tier, message, reply, dynamicContext, expectedBehavior)
      : [];

    // ── Push all scores to Langfuse ────────────────────────────
    if (traceId) {
      const scorePromises = [
        // Deterministic scores (boolean as 0/1) — strictly tool-call checks
        langfuse.score.create({ traceId, name: 'tool_must_call', dataType: 'BOOLEAN', value: result.toolMustCallPass ? 1 : 0 }),
        langfuse.score.create({ traceId, name: 'tool_must_not_call', dataType: 'BOOLEAN', value: result.toolMustNotCallPass ? 1 : 0 }),
        langfuse.score.create({ traceId, name: 'overall_pass', dataType: 'BOOLEAN', value: result.overallPass ? 1 : 0 }),
        // LLM-as-judge scores (numeric 0–1) with the judge's reasoning as comment
        ...judgeScores.map((j) =>
          langfuse.score.create({ traceId, name: j.name, dataType: 'NUMERIC', value: j.value, comment: j.comment })
        ),
      ];

      await Promise.all(scorePromises);
    }

    // ── Log result to terminal ──────────────────────────────────
    // PASS/FAIL reflects the DETERMINISTIC tool checks only. Judge scores are
    // continuous (0–1) and printed alongside — they don't flip pass/fail.
    const judgeSummary = judgeScores.length
      ? '  | ' + judgeScores.map((j) => `${j.name.replace('judge_', '')}=${j.value.toFixed(2)}`).join(' ')
      : '';

    if (result.overallPass) {
      console.log(`✅  PASS${judgeSummary}`);
      summary.passed++;
      summary.byTier[tier].passed++;
    } else {
      console.log(`❌  FAIL${judgeSummary}`);
      summary.failed++;

      // Print exactly which tool check failed so you know what to fix
      if (result.missingTools.length > 0)
        console.log(`       toolsMustCall missing: ${result.missingTools.join(', ')}`);
      if (result.forbiddenToolsCalled.length > 0)
        console.log(`       toolsMustNotCall violated: ${result.forbiddenToolsCalled.join(', ')}`);
    }
  }

  // ── Restore eval user memory to pre-run state ───────────────────────────
  await prisma.user.update({
    where: { id: evalUser.id },
    data: { aiMemory: originalMemory ?? Prisma.DbNull },
  });
  await redis.del(`ai:memory:${evalUser.id}`);
  redis.disconnect();

  // ── Print final summary with per-slice gating ──────────────────────────
  const runMetadata = getRunMetadata();

  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Eval Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`   Run:      ${runName}`);
  console.log(`   Total:    ${summary.total}`);
  console.log(`   Passed:   ${summary.passed}  ✅`);
  console.log(`   Failed:   ${summary.failed}  ❌`);
  if (summary.errors > 0) console.log(`   Errors:   ${summary.errors}  💥`);
  console.log('');

  // ── Per-slice gating ───────────────────────────────────────────────────
  // Each tier has a threshold. If ANY tier drops below its threshold, the
  // run is considered FAILED (this is what would block a merge in CI).
  let gatePass = true;
  console.log('   Per-slice results (vs threshold):');
  for (const [tier, counts] of Object.entries(summary.byTier)) {
    const rate = counts.passed / counts.total;
    const threshold = EVAL_CONFIG.sliceThresholds[tier] ?? 0.80;
    const pct = (rate * 100).toFixed(0);
    const threshPct = (threshold * 100).toFixed(0);
    const passed = rate >= threshold;
    if (!passed) gatePass = false;
    const icon = passed ? '✅' : '❌';
    console.log(`   ${icon}  ${tier.padEnd(18)} ${counts.passed}/${counts.total} (${pct}%)  threshold: ${threshPct}%`);
  }

  console.log('');
  if (gatePass) {
    console.log('   🟢 GATE: PASS — all slices meet their thresholds');
  } else {
    console.log('   🔴 GATE: FAIL — one or more slices below threshold (would block merge)');
  }

  // ── Version metadata ───────────────────────────────────────────────────
  console.log('\n   Versions:');
  console.log(`     dataset:  ${runMetadata.datasetName} @ ${runMetadata.datasetVersion}`);
  console.log(`     coach:    ${runMetadata.coachModel}`);
  console.log(`     judge:    ${runMetadata.judgeModel}`);
  console.log(`     prompts:  ${runMetadata.promptVersion}`);
  console.log(`\n   View in Langfuse → Experiments → ${runName}\n`);

  await langfuse.shutdown();
  if (otelSdk) {
    await otelSdk.shutdown();
  }
  await prisma.$disconnect();

  // Exit with non-zero if the gate failed (for CI integration)
  if (!gatePass) process.exit(1);
}

runEval()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Runner failed:', err);
    redis.disconnect();
    prisma.$disconnect();
    process.exit(1);
  });
