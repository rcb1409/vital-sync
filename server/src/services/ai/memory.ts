import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { Prisma } from '@prisma/client';
import { env } from '@/config/env';
import { prisma } from '@/config/database';
import { redis } from '@/config/redis';
import { bedrock } from '@/config/bedrock';
import { getMemoryExtractionPrompt } from './prompts';

/** Redis key for a user's long-term memory facts. */
export const memoryKey = (userId: string) => `ai:memory:${userId}`;

/** Shape of a single memory fact. */
export interface MemoryFact {
  category: string;
  fact: string;
  expiresAt: string | null;
}

/**
 * Anthropic tool definition for the memory extractor.
 *
 * We force the model to call this tool via
 * `tool_choice: { type: 'tool', name: 'save_memory_facts' }`.
 * This guarantees structured JSON output — the model MUST produce an object
 * matching this schema. No free text, no parsing risk.
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
 * Pure extraction — LLM call only, no side effects.
 *
 * Given a conversation exchange and the current memory state, calls the LLM
 * to produce an updated list of facts. Returns the new facts array without
 * persisting anything. This is the testable unit for the memory eval.
 */
export async function extractMemory(
  userMessage: string,
  aiResponse: string,
  currentMemory: MemoryFact[],
  todayOverride?: string,
): Promise<MemoryFact[]> {
  const today = new Date();
  const todayStr = todayOverride || today.toISOString().split('T')[0];
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const fullDateStr = `${dayName}, ${todayStr}`;
  const extractionPrompt = getMemoryExtractionPrompt(userMessage, aiResponse, currentMemory, fullDateStr);

  const response = await bedrock.messages.create({
    model: env.BEDROCK_MODEL_ID,
    max_tokens: 1024,
    tools: [memoryTool],
    tool_choice: { type: 'tool', name: 'save_memory_facts' },
    messages: [{ role: 'user', content: extractionPrompt }],
  });

  const toolBlock = response.content.find(
    (b): b is ToolUseBlock => b.type === 'tool_use'
  );
  if (!toolBlock) throw new Error('Memory extractor: tool_use block not found in response');

  const { facts } = toolBlock.input as { facts: MemoryFact[] };
  return Array.isArray(facts) ? facts : [];
}

/**
 * Full extract-and-save — called in production after the coach reply is sent.
 *
 * Calls extractMemory() then persists to DB and invalidates Redis cache.
 * Wrapped in try/catch for graceful degradation (non-critical path).
 */
export async function extractAndSaveMemory(
  userId: string,
  userMessage: string,
  aiResponse: string,
  currentMemory: MemoryFact[]
) {
  try {
    const facts = await extractMemory(userMessage, aiResponse, currentMemory);

    // Persist to DB (source of truth).
    // Prisma's Json input type doesn't accept a typed array directly —
    // MemoryFact[] lacks the string index signature InputJsonObject wants.
    await prisma.user.update({
      where: { id: userId },
      data: { aiMemory: facts as unknown as Prisma.InputJsonValue },
    });

    // Invalidate the Redis cache so the next chat request
    // fetches fresh memory from the DB and re-populates the cache.
    await redis.del(memoryKey(userId));

    console.log('✅ Memory Extracted & Saved. Cache invalidated.', facts);
  } catch (err) {
    // Graceful degradation — user experience is unaffected.
    console.warn('⚠️ Memory extraction failed (non-critical):', (err as Error).message);
  }
}
