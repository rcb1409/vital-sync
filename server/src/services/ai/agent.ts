import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '@/config/env';
import { anthropic } from '@/config/anthropic';
import { coachTools } from './tools';
import { executeToolCall, classifyError } from './executor';

/** Return type for the agent loop. */
export interface AgentLoopResult {
  reply: string;
  toolsCalled: string[];
}

/**
 * The ReAct agent loop — talks to the Anthropic API (Claude) and calls tools.
 *
 * Each iteration:
 *   1. Send `messages` to the API with tool definitions and system prompt.
 *   2. Push the assistant reply (text + tool_use blocks) onto `messages`.
 *   3. If stop_reason === 'end_turn' → extract text, return.
 *   4. If stop_reason === 'tool_use' → execute every tool_use in parallel,
 *      append a single user message containing one tool_result block per call.
 *
 * Capped at MAX_TURNS to prevent runaway loops.
 */
const MAX_TURNS = 5;

export async function runAgentLoop(
  systemPrompt: string,
  messages: MessageParam[],
  userId: string,
): Promise<AgentLoopResult> {
  const toolsCalled: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL_ID,
      max_tokens: 2048,
      system: systemPrompt,
      tools: coachTools,
      messages,
    });

    // Always append the assistant's full content — the next turn's request
    // must include it so the API can correlate tool_use IDs with tool_result IDs.
    messages.push({ role: 'assistant', content: response.content });

    // 'end_turn', 'max_tokens', or 'stop_sequence' — all mean we're done.
    if (response.stop_reason !== 'tool_use') {
      const reply = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      return { reply: reply || "I wasn't able to complete that request. Please try again.", toolsCalled };
    }

    // The model wants to call tools — execute them all in parallel.
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use'
    );

    console.log(`🔁 Agent turn ${turn + 1}: executing ${toolUseBlocks.length} tool(s)...`);

    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        try {
          const result = await executeToolCall(userId, {
            name: block.name,
            args: block.input as Record<string, any>,
          });
          toolsCalled.push(block.name);
          console.log(`  ✅ Tool "${block.name}" succeeded`);

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

          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(classified),
            is_error: true,
          };
        }
      })
    );

    // Send all tool results back as a single user-role message for the next turn.
    messages.push({ role: 'user', content: toolResults });
  }

  console.error('❌ Agent loop hit MAX_TURNS without a final answer.');
  return { reply: "I wasn't able to complete that request. Please try again.", toolsCalled };
}
