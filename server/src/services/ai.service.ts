import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '../config/env';
import { prisma } from '@/config/database';
import { redis } from '../config/redis';
import { cacheService } from './cache.service';
import { buildUserContext, getSystemInstruction, getMemoryExtractionPrompt } from './ai/prompts';
import { coachTools } from './ai/tools';
import { executeToolCall, classifyError } from './ai/executor';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';
import { bedrock } from '../config/bedrock';

/**
 * Converts the legacy Gemini-shaped history array sent by the client
 * (`{ role: 'user' | 'model', parts: [{ text }] }`) into Anthropic's
 * (`{ role: 'user' | 'assistant', content: string }`).
 *
 * Only text parts are carried over — intermediate tool-call turns from the
 * old Gemini agent loop are NOT in user-visible history, so this is safe.
 */
function convertHistoryToAnthropic(history: any[]): MessageParam[] {
  if (!Array.isArray(history)) return [];
  const out: MessageParam[] = [];
  for (const item of history) {
    if (!item || !item.role || !Array.isArray(item.parts)) continue;
    const text = item.parts
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n');
    if (!text) continue; // skip turns that had only functionCall / functionResponse parts
    out.push({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: text,
    });
  }
  return out;
}

// Redis key for a user's long-term memory facts
const memoryKey = (userId: string) => `ai:memory:${userId}`;

// Legacy local prompt-version tag — kept as a coarse fallback identifier.
// The real per-component versions now come from Langfuse (see promptBundle.versions)
// and are attached to trace metadata + linked to each generation.
const PROMPT_VERSION = 'v1.2';

/**
 * Anthropic tool definition used exclusively by the memory extractor.
 *
 * We force the model to call this tool via `tool_choice: { type: 'tool', name: 'save_memory_facts' }`.
 * That gives us the same guarantee as Gemini's `responseSchema` — the model MUST
 * output a structured JSON object matching this schema. No free text, no parsing risk.
 */
const memoryTool: Tool = {
  name: 'save_memory_facts',
  description: 'Save the updated list of long-term facts about the user.',
  input_schema: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        description: 'Updated list of long-term facts about the user.',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: "Category of the fact (e.g., 'health', 'preferences', 'injury').",
            },
            fact: { type: 'string', description: 'The actual fact statement.' },
            expiresAt: {
              type: 'string',
              description: 'ISO 8601 date string when this fact expires. null if permanent.',
            },
          },
          required: ['category', 'fact'],
        },
      },
    },
    required: ['facts'],
  },
};

/**
 * Background memory extractor — runs after the user already has their reply.
 *
 * Uses the "tool-as-JSON" trick: we register a single tool (`save_memory_facts`)
 * and force Anthropic to call it via `tool_choice: { type: 'tool', name: ... }`.
 * The model's tool `input` IS the structured JSON — no JSON.parse, no free-text risk.
 *
 * Equivalent to Gemini's `responseMimeType: 'application/json'` + `responseSchema`.
 */
async function extractAndSaveMemory(
  userId: string,
  userMessage: string,
  aiResponse: string,
  currentMemory: any[]
) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
    const fullDateStr = `${dayName}, ${todayStr}`;
    const extractionPrompt = getMemoryExtractionPrompt(userMessage, aiResponse, currentMemory, fullDateStr);

    const response = await bedrock.messages.create({
      model: env.BEDROCK_MODEL_ID,
      max_tokens: 1024,
      tools: [memoryTool],
      // Force the model to call save_memory_facts — it cannot return free text.
      // This is the Anthropic equivalent of Gemini's responseSchema guarantee.
      tool_choice: { type: 'tool', name: 'save_memory_facts' },
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    // Find the forced tool_use block — always present because we used tool_choice above
    const toolBlock = response.content.find(
      (b): b is ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) throw new Error('Memory extractor: tool_use block not found in response');

    const { facts } = toolBlock.input as { facts: any[] };

    if (Array.isArray(facts)) {
      // 1. Persist to DB (source of truth)
      await prisma.user.update({
        where: { id: userId },
        data: { aiMemory: facts },
      });

      // 2. Invalidate the Redis cache so the next chat request
      //    fetches fresh memory from the DB and re-populates the cache.
      //    We delete rather than update to keep the write path simple.
      await redis.del(memoryKey(userId));

      console.log('✅ Memory Extracted & Saved. Cache invalidated.', facts);
    }
  } catch (err) {
    // Graceful degradation — user experience is unaffected.
    // The conversation reply was already sent before this ran.
    console.warn('⚠️ Memory extraction failed (non-critical):', (err as Error).message);
  }
}

/** Return type for the agent loop to carry across observation boundaries. */
interface AgentTurnResult {
  reply: string;
  done: boolean;
}

/**
 * STEP 1 (Main): The Agent — talks to the user and calls tools.
 * Returns plain text directly. No JSON parsing required.
 *
 * Tracing (Langfuse v5 / OTEL):
 *   The entire function is wrapped in `startActiveObservation` which creates
 *   the root trace span. `propagateAttributes` attaches userId/sessionId/metadata
 *   to all child observations. Child spans (context, prompt, generation, tool)
 *   are created via nested `startActiveObservation` calls and auto-parent
 *   under the root thanks to OTEL context propagation.
 */
async function chatWithCoach(
  userId: string,
  userMessage: string,
  history: any[] = [],
  sessionId?: string,
  evalMetadata?: Record<string, any>,
) {
  // Wrap the entire conversation turn in attribute propagation + root observation
  return propagateAttributes(
    {
      userId,
      sessionId: sessionId || undefined,
    },
    () => startActiveObservation('chatWithCoach', async (rootSpan) => {

      rootSpan.update({ input: userMessage });

      // 2. Span: Track how long the database takes to build context
      const contextString: string = await startActiveObservation(
        'build-user-context',
        async (_span) => {
          return buildUserContext(userId);
        }
      );

      // 3. Span: Fetch the three Langfuse-managed system prompts (or local fallback).
      //    Cached by the SDK, so this is effectively free after the first call.
      const promptBundle = await startActiveObservation(
        'fetch-system-prompt',
        async (span) => {
          const bundle = await getSystemInstruction(contextString);
          span.update({ output: { source: bundle.source, versions: bundle.versions } });
          return bundle;
        }
      );

      const { systemInstruction } = promptBundle;

      // Read memory via cache-aside: Redis first, DB on miss, no TTL.
      // Memory is invalidated (not expired) — it lives until the user changes a fact.
      const currentMemory = await cacheService.cacheAside<any[]>(
        memoryKey(userId),
        0,  // TTL of 0 means: store without expiry (redis.set without 'EX')
        async () => {
          const profile = await prisma.user.findUnique({
            where: { id: userId },
            select: { aiMemory: true },
          });
          return (profile?.aiMemory as any[]) || [];
        }
      );

      // Attach metadata to the root span so it propagates to all child observations.
      rootSpan.update({
        metadata: {
          promptVersion: PROMPT_VERSION,
          promptVersions: promptBundle.versions,
          promptSource: promptBundle.source,
          dynamicContext: contextString,
          memorySnapshot: currentMemory,
          ...evalMetadata,
        },
      });

      // ── Eval mode: stamp Langfuse experiment attributes ─────────
      // When called from the eval runner, evalMetadata contains dataset
      // linkage info. Setting these OTEL attributes is the canonical way
      // to register a trace in the Langfuse Experiments UI — it's exactly
      // what langfuse.experiment.run() does internally.
      if (evalMetadata?.datasetRunName) {
        const expAttrs: Record<string, string> = {
          'langfuse.experiment.name':       evalMetadata.datasetRunName,
          'langfuse.experiment.dataset.id': evalMetadata.datasetId,
          'langfuse.experiment.item.id':    evalMetadata.datasetItemId,
        };
        if (evalMetadata.expectedOutput !== undefined) {
          expAttrs['langfuse.experiment.item.expected_output'] =
            JSON.stringify(evalMetadata.expectedOutput);
        }
        rootSpan.otelSpan.setAttributes(expAttrs);
      }

      // ==========================================
      // REACT AGENT LOOP (Anthropic Claude Haiku 4.5 on Bedrock)
      //
      // Anthropic has no `chat` object — we manage the messages array ourselves.
      // Each iteration:
      //   1. Send `messages` to Bedrock with tool definitions and system prompt.
      //   2. Push the assistant reply (text + tool_use blocks) onto `messages`.
      //   3. If stop_reason === 'end_turn' → extract text, exit loop.
      //   4. If stop_reason === 'tool_use' → execute every tool_use in parallel,
      //      append a single user message containing one tool_result block per call.
      // Capped at MAX_AGENT_TURNS to prevent runaway loops.
      // ==========================================
      const MAX_AGENT_TURNS = 5;

      // Build the message array: prior history (converted from Gemini shape)
      // followed by the new user turn.
      const messages: MessageParam[] = [
        ...convertHistoryToAnthropic(history),
        { role: 'user', content: userMessage },
      ];

      let agentReply = '';
      const toolsCalled: string[] = [];

      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        // Each agent turn gets its own generation observation.
        const turnResult: AgentTurnResult = await startActiveObservation(
          `bedrock-agent-turn-${turn}`,
          async (gen) => {
            gen.update({
              model: env.BEDROCK_MODEL_ID,
              input: turn === 0 ? userMessage : 'tool_results',
            });

            const response = await bedrock.messages.create({
              model: env.BEDROCK_MODEL_ID,
              max_tokens: 2048,
              system: systemInstruction,
              tools: coachTools,
              messages,
            });

            // Always append the assistant's full content (text + any tool_use blocks)
            // — the next turn's request must include it for Anthropic to correlate
            // tool_use IDs with tool_result IDs.
            messages.push({ role: 'assistant', content: response.content });

            if (response.stop_reason !== 'tool_use') {
              // 'end_turn' (normal), 'max_tokens', or 'stop_sequence' — all mean we're done.
              const reply = response.content
                .filter((b): b is TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
                .trim();

              // Rename the final generation and attach context so the Langfuse
              // LLM-as-judge evaluator (which runs at GENERATION level) can
              // access dynamicContext + memorySnapshot for hallucination checks.
              const finalName = evalMetadata ? 'eval-coach-final-reply' : 'coach-final-reply';
              gen.update({
                output: reply,
                usageDetails: {
                  input: response.usage.input_tokens,
                  output: response.usage.output_tokens,
                },
                metadata: {
                  name: finalName,
                  dynamicContext: contextString,
                  memorySnapshot: currentMemory,
                  ...evalMetadata,
                },
              });

              return { reply, done: true };
            }

            gen.update({
              output: 'tool_use_requested',
              usageDetails: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
              },
            });

            const toolUseBlocks = response.content.filter(
              (b): b is ToolUseBlock => b.type === 'tool_use'
            );

            console.log(`🔁 Agent turn ${turn + 1}: executing ${toolUseBlocks.length} tool(s)...`);

            // Execute ALL requested tools in parallel
            const toolResults: ToolResultBlockParam[] = await Promise.all(
              toolUseBlocks.map(async (block) => {
                return startActiveObservation(
                  `tool-execution:${block.name}`,
                  async (toolSpan) => {
                    toolSpan.update({ input: block.input as any });

                    try {
                      const result = await executeToolCall(userId, {
                        name: block.name,
                        args: block.input as Record<string, any>,
                      });
                      toolsCalled.push(block.name);
                      console.log(`  ✅ Tool "${block.name}" succeeded`);
                      toolSpan.update({ output: result });

                      return {
                        type: 'tool_result' as const,
                        tool_use_id: block.id,
                        content: JSON.stringify(result),
                      };
                    } catch (err) {
                      const classified = classifyError(err);
                      console.warn(
                        `  ⚠️ Tool "${block.name}" failed (canRetry: ${classified.canRetry}):`,
                        classified.error
                      );
                      toolSpan.update({ output: classified, level: 'ERROR' });

                      return {
                        type: 'tool_result' as const,
                        tool_use_id: block.id,
                        content: JSON.stringify(classified),
                        is_error: true,
                      };
                    }
                  },
                  { asType: 'tool' }
                );
              })
            );

            // Send ALL tool results back as a single user-role message for the next turn
            messages.push({ role: 'user', content: toolResults });

            return { reply: '', done: false };
          },
          { asType: 'generation' }
        );

        if (turnResult.done) {
          agentReply = turnResult.reply;
          break;
        }
      }

      if (!agentReply) {
        console.error('❌ Agent loop hit MAX_AGENT_TURNS without a final answer.');
        agentReply = "I wasn't able to complete that request. Please try again.";
      }

      // Set trace output so Langfuse UI shows the final reply on the trace
      rootSpan.update({ output: agentReply });

      // Fire memory extraction in the background — user already has their reply.
      extractAndSaveMemory(userId, userMessage, agentReply, currentMemory);

      // rootSpan.traceId is the raw OTEL hex trace ID (32 chars, no dashes).
      // Langfuse stores and indexes traces using this same raw hex format.
      // Do NOT convert to UUID (dashes) — Langfuse won't match the two formats
      // when the evaluator looks up the linked trace from a dataset run item.
      return { reply: agentReply, toolsCalled, traceId: rootSpan.traceId, dynamicContext: contextString };
    })
  );
}

/**
 * TEMPORARY (between step 2 and step 3 of the Gemini → Bedrock migration).
 *
 * This used to stream tokens from Gemini. The agent has now moved to Bedrock
 * (see `chatWithCoach` above), but Bedrock's streaming has a different SDK
 * shape that we'll wire up in step 3.
 *
 * For the moment, we proxy to the non-streaming Bedrock agent and emit the
 * full reply as a single SSE chunk. The chat UI keeps working — it just
 * won't render token-by-token until step 3.
 */
async function chatWithCoachStream(
  userId: string,
  userMessage: string,
  history: any[] = [],
  onChunk: (text: string) => void,
  _onStatus: (status: string) => void,
  sessionId?: string,
) {
  const result = await chatWithCoach(userId, userMessage, history, sessionId);
  if (result.reply) onChunk(result.reply);
  return result;
}

export const aiService = {
  chatWithCoach,
  chatWithCoachStream,
};
