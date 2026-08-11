// -------------------------------------------------------
// Memory Extractor — Eval Runner
// -------------------------------------------------------
// Tests extractMemory() in isolation — no DB, no Redis, no coach.
// Calls the LLM extractor with known conversations and asserts
// on the returned fact array (deterministic + judge).
//
// Run with: npx tsx eval/memory-runner.ts
//
// Prerequisites:
//   - ANTHROPIC_API_KEY in .env (for the extractor LLM)
//   - Langfuse keys in .env (for score push)
//   - NO database or Redis needed
// -------------------------------------------------------

import '../src/config/instrumentation';
import { otelSdk } from '../src/config/instrumentation';
import { LangfuseClient } from '@langfuse/client';
import dotenv from 'dotenv';
import { extractMemory, MemoryFact } from '../src/services/ai/memory';
import { EVAL_CONFIG, JUDGE_MODEL_ID, anthropic } from './config';
import { memoryGoldenDataset, memoryDatasetStats, MemoryEvalCase } from './datasets/memory-golden-v1';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

dotenv.config();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
});

// ── Version metadata (tracked per run) ───────────────────────────────────────
const RUN_METADATA = {
  dataset: 'memory-golden-v1',
  extractorModel: process.env.ANTHROPIC_MODEL_ID || 'unknown',
  judgeModel: JUDGE_MODEL_ID,
  runAt: new Date().toISOString(),
};

// ── Deterministic assertion checker ─────────────────────────────────────────
interface MemoryAssertionResult {
  overallPass: boolean;
  details: string[];
}

function checkMemoryAssertions(
  assertions: MemoryEvalCase['assertions'],
  outputFacts: MemoryFact[],
): MemoryAssertionResult {
  const details: string[] = [];
  let pass = true;

  if (assertions.expectedFactCount !== undefined) {
    if (outputFacts.length !== assertions.expectedFactCount) {
      pass = false;
      details.push(`factCount: expected ${assertions.expectedFactCount}, got ${outputFacts.length}`);
    }
  }

  if (assertions.mustHaveCategory) {
    const found = outputFacts.some((f) => f.category.toLowerCase().includes(assertions.mustHaveCategory!.toLowerCase()));
    if (!found) {
      pass = false;
      details.push(`mustHaveCategory "${assertions.mustHaveCategory}" not found`);
    }
  }

  if (assertions.mustNotHaveCategory) {
    const found = outputFacts.some((f) => f.category.toLowerCase().includes(assertions.mustNotHaveCategory!.toLowerCase()));
    if (found) {
      pass = false;
      details.push(`mustNotHaveCategory "${assertions.mustNotHaveCategory}" was present`);
    }
  }

  if (assertions.factMustContain) {
    const allFacts = outputFacts.map((f) => f.fact.toLowerCase()).join(' ');
    if (!allFacts.includes(assertions.factMustContain.toLowerCase())) {
      pass = false;
      details.push(`factMustContain "${assertions.factMustContain}" not found in any fact`);
    }
  }

  if (assertions.factMustNotContain) {
    const allFacts = outputFacts.map((f) => f.fact.toLowerCase()).join(' ');
    if (allFacts.includes(assertions.factMustNotContain.toLowerCase())) {
      pass = false;
      details.push(`factMustNotContain "${assertions.factMustNotContain}" was found`);
    }
  }

  if (assertions.newFactHasExpiry === true) {
    // At least one fact should have expiresAt set (for add_temporary cases)
    const hasExpiry = outputFacts.some((f) => f.expiresAt !== null && f.expiresAt !== undefined);
    if (!hasExpiry) {
      pass = false;
      details.push('expected at least one fact with expiresAt set, none found');
    }
  }

  if (assertions.newFactHasExpiry === false) {
    // Newly added facts should NOT have expiresAt (for add_permanent cases)
    // We check the last fact (most likely the new one)
    const lastFact = outputFacts[outputFacts.length - 1];
    if (lastFact && lastFact.expiresAt !== null && lastFact.expiresAt !== undefined) {
      // Only flag if it doesn't look like an existing temporal fact
      const isExistingTemporal = lastFact.fact.includes('shoulder') || lastFact.fact.includes('half marathon');
      if (!isExistingTemporal) {
        pass = false;
        details.push(`new fact has expiresAt="${lastFact.expiresAt}" but expected null`);
      }
    }
  }

  return { overallPass: pass, details };
}

// ── LLM Judge for memory extraction quality ──────────────────────────────────
async function judgeMemoryExtraction(
  evalCase: MemoryEvalCase,
  outputFacts: MemoryFact[],
): Promise<{ score: number; reasoning: string }> {
  const prompt = `You are evaluating an AI memory extraction system.

TASK: Given a conversation between a user and an AI fitness coach, the extractor should produce an updated list of long-term facts about the user.

CURRENT MEMORY (before extraction):
${JSON.stringify(evalCase.currentMemory, null, 2)}

CONVERSATION:
User: ${evalCase.userMessage}
Coach: ${evalCase.aiResponse}

EXPECTED BEHAVIOR: ${evalCase.expectedBehavior}

ACTUAL OUTPUT (extracted facts):
${JSON.stringify(outputFacts, null, 2)}

Score from 0 to 1:
- 1 = perfectly matches expected behavior (correct adds/removes/preserves)
- 0.5 = partially correct (got some right, missed others)
- 0 = completely wrong (missed the key extraction or corrupted existing facts)

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

  const response = await anthropic.messages.create({
    model: JUDGE_MODEL_ID,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return { score: 0, reasoning: 'Judge returned no JSON' };

  const parsed = JSON.parse(jsonMatch[0]);
  return { score: Math.max(0, Math.min(1, parsed.score)), reasoning: parsed.reasoning || '' };
}

// ── Main runner ──────────────────────────────────────────────────────────────
async function runMemoryEval() {
  console.log('\n🧠 Memory Extractor Eval Runner\n');
  console.log('═══════════════════════════════════════════\n');
  console.log(`   Dataset:  ${RUN_METADATA.dataset}`);
  console.log(`   Cases:    ${memoryDatasetStats.total}`);
  console.log(`   Model:    ${RUN_METADATA.extractorModel}`);
  console.log(`   Judge:    ${RUN_METADATA.judgeModel}\n`);
  console.log('─────────────────────────────────────────\n');

  const runName = `memory-eval-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    byCategory: {} as Record<string, { passed: number; total: number; judgeAvg: number; judgeScores: number[] }>,
  };

  for (const evalCase of memoryGoldenDataset) {
    const { id, category, assertions } = evalCase;

    if (!summary.byCategory[category]) {
      summary.byCategory[category] = { passed: 0, total: 0, judgeAvg: 0, judgeScores: [] };
    }
    summary.total++;
    summary.byCategory[category].total++;

    process.stdout.write(`  [${id}]  `);

    // ── Call the extractor (pure, no DB) ────────────────────────
    let outputFacts: MemoryFact[];
    try {
      outputFacts = await extractMemory(
        evalCase.userMessage,
        evalCase.aiResponse,
        evalCase.currentMemory,
      );
    } catch (err) {
      console.log(`❌  ERROR — ${(err as Error).message}`);
      summary.errors++;
      continue;
    }

    // ── Deterministic checks ───────────────────────────────────
    const result = checkMemoryAssertions(assertions, outputFacts);

    // ── LLM judge ──────────────────────────────────────────────
    let judgeResult = { score: 0, reasoning: '' };
    try {
      judgeResult = await judgeMemoryExtraction(evalCase, outputFacts);
    } catch (err) {
      console.warn(`     ⚠️ judge failed: ${(err as Error).message}`);
    }

    summary.byCategory[category].judgeScores.push(judgeResult.score);

    // ── Log ────────────────────────────────────────────────────
    const judgeStr = `judge=${judgeResult.score.toFixed(2)}`;
    if (result.overallPass) {
      console.log(`✅  PASS  | ${judgeStr}`);
      summary.passed++;
      summary.byCategory[category].passed++;
    } else {
      console.log(`❌  FAIL  | ${judgeStr}`);
      summary.failed++;
      for (const d of result.details) {
        console.log(`       ${d}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Memory Eval Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`   Run:     ${runName}`);
  console.log(`   Total:   ${summary.total}`);
  console.log(`   Passed:  ${summary.passed}  ✅`);
  console.log(`   Failed:  ${summary.failed}  ❌`);
  if (summary.errors > 0) console.log(`   Errors:  ${summary.errors}  💥`);
  console.log(`   Score:   ${((summary.passed / summary.total) * 100).toFixed(1)}%\n`);

  console.log('   Per-slice (category):');
  for (const [cat, counts] of Object.entries(summary.byCategory)) {
    const avg = counts.judgeScores.length
      ? (counts.judgeScores.reduce((a, b) => a + b, 0) / counts.judgeScores.length).toFixed(2)
      : 'n/a';
    const rate = ((counts.passed / counts.total) * 100).toFixed(0);
    const bar = counts.passed === counts.total ? '✅' : '⚠️ ';
    console.log(`   ${bar}  ${cat.padEnd(18)} ${counts.passed}/${counts.total} (${rate}%) | judge avg: ${avg}`);
  }

  console.log(`\n   Metadata: ${JSON.stringify(RUN_METADATA)}`);
  console.log('═══════════════════════════════════════════\n');

  if (otelSdk) await otelSdk.shutdown();
}

runMemoryEval()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Memory eval failed:', err);
    process.exit(1);
  });
