// -------------------------------------------------------
// LLM-as-Judge Evaluators
// -------------------------------------------------------
// Each function calls Sonnet to score one quality dimension
// of the coach's reply. Returns a 0–1 float score.
//
// These run locally in the eval runner and push scores to
// Langfuse via langfuse.score(). No Langfuse UI evaluator
// config needed — scores appear on traces automatically.
// -------------------------------------------------------

import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { bedrock, JUDGE_MODEL_ID } from './config';

interface JudgeResult {
  score: number;    // 0–1
  reasoning: string;
}

async function callJudge(prompt: string): Promise<JudgeResult> {
  const response = await bedrock.messages.create({
    model: JUDGE_MODEL_ID,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error(`No JSON in judge response: ${text.slice(0, 100)}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    score: Math.max(0, Math.min(1, parsed.score)),
    reasoning: parsed.reasoning || '',
  };
}

// -------------------------------------------------------
// Hallucination
// -------------------------------------------------------
// Checks if the coach's reply contains facts NOT grounded
// in the provided context (user's actual data).
// Score 0 = fully grounded, 1 = hallucinated.
// -------------------------------------------------------
export async function judgeHallucination(
  query: string,
  generation: string,
  context: string,
): Promise<JudgeResult> {
  const prompt = `You are evaluating an AI fitness coach's response for hallucination.

The following CONTEXT is the ground truth — it contains the user's actual nutrition data, goals, streaks, and long-term memory facts. If the coach states numbers or facts that contradict or are not present in this context, that is hallucination.

CONTEXT:
${context}

USER QUERY: ${query}

COACH RESPONSE: ${generation}

Score from 0 to 1:
- 0 = fully grounded in context, no fabricated facts
- 0.5 = minor inaccuracies or unsupported claims
- 1 = major hallucination (invented numbers, contradicts context)

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

  return callJudge(prompt);
}

// -------------------------------------------------------
// Correctness
// -------------------------------------------------------
// Checks if the reply matches the expected behavior
// defined in the golden dataset.
// Score 0 = completely wrong, 1 = fully correct.
// -------------------------------------------------------
export async function judgeCorrectness(
  query: string,
  generation: string,
  expectedBehavior: string,
): Promise<JudgeResult> {
  const prompt = `You are evaluating an AI fitness coach's response for correctness against an expected behavior.

EXPECTED BEHAVIOR: ${expectedBehavior}

USER QUERY: ${query}

COACH RESPONSE: ${generation}

Score from 0 to 1:
- 1 = the response fully matches the expected behavior
- 0.5 = partially matches (gets some things right, misses others)
- 0 = completely fails to match the expected behavior

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

  return callJudge(prompt);
}

// -------------------------------------------------------
// Helpfulness
// -------------------------------------------------------
// Checks if the response is useful, actionable, and
// directly addresses the user's question.
// Score 0 = unhelpful, 1 = highly helpful.
// -------------------------------------------------------
export async function judgeHelpfulness(
  query: string,
  generation: string,
): Promise<JudgeResult> {
  const prompt = `You are evaluating an AI fitness coach's response for helpfulness.

USER QUERY: ${query}

COACH RESPONSE: ${generation}

Score from 0 to 1:
- 1 = highly useful, actionable, directly addresses the question
- 0.5 = somewhat helpful but vague or incomplete
- 0 = unhelpful, irrelevant, or confusing

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

  return callJudge(prompt);
}

// -------------------------------------------------------
// Out-of-Scope
// -------------------------------------------------------
// Checks if the coach correctly handled an out-of-scope
// request (not fitness/nutrition/health related).
// Score 1 = handled correctly (acknowledged + redirected),
// Score 0 = failed (engaged with off-topic content).
// Only meaningful for edge_case tier.
// -------------------------------------------------------
export async function judgeOutOfScope(
  query: string,
  generation: string,
): Promise<JudgeResult> {
  const prompt = `You are evaluating an AI fitness/health coach's handling of a potentially out-of-scope request.

This AI coach's scope includes: workout planning, exercise, nutrition, meal suggestions, hydration, sleep, supplements, and wellness. It should politely decline requests outside this scope and redirect to fitness/health topics.

USER QUERY: ${query}

COACH RESPONSE: ${generation}

First determine if the query IS out of scope. Then score:
- If the query IS out of scope:
  - 1 = coach correctly declined and redirected to fitness/health
  - 0.5 = coach partially engaged but mentioned it's outside scope
  - 0 = coach fully engaged with the off-topic request
- If the query is IN scope:
  - 1 = coach responded appropriately (this is correct behavior)

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

  return callJudge(prompt);
}
