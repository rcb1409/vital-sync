import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { prisma } from '@/config/database';
import { cacheService } from './cache.service';
import { buildUserContext, getSystemInstruction } from './ai/prompts';
import { runAgentLoop } from './ai/agent';
import { extractAndSaveMemory, memoryKey } from './ai/memory';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';

/**
 * The AI coach orchestrator.
 *
 * Wires together: context building, prompt assembly, the agent loop,
 * Langfuse tracing, and background memory extraction.
 *
 * The agent loop itself lives in `ai/agent.ts` — this file only
 * coordinates the pieces and adds observability.
 */
async function chatWithCoach(
  userId: string,
  userMessage: string,
  history: MessageParam[] = [],
  sessionId?: string,
  evalMetadata?: Record<string, any>,
) {
  return propagateAttributes(
    {
      userId,
      sessionId: sessionId || undefined,
    },
    () => startActiveObservation('chatWithCoach', async (rootSpan) => {

      rootSpan.update({ input: userMessage });

      // Build today's context snapshot — or use a pre-built override (eval mode).
      // contextOverride lets the eval harness inject a fixed context string,
      // removing the DB/Redis dependency and enabling scenario-based testing.
      const contextString: string = evalMetadata?.contextOverride
        ? evalMetadata.contextOverride
        : await startActiveObservation(
            'build-user-context',
            async (_span) => buildUserContext(userId)
          );

      // Fetch Langfuse-managed system prompts (cached by the SDK).
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
        0,
        async () => {
          const profile = await prisma.user.findUnique({
            where: { id: userId },
            select: { aiMemory: true },
          });
          return (profile?.aiMemory as any[]) || [];
        }
      );

      // Attach metadata to the root span for Langfuse tracing.
      rootSpan.update({
        metadata: {
          promptVersions: promptBundle.versions,
          promptSource: promptBundle.source,
          dynamicContext: contextString,
          memorySnapshot: currentMemory,
          ...evalMetadata,
        },
      });

      // Eval mode: stamp Langfuse experiment attributes when called from the eval runner.
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

      // Build the message array: prior history + the new user turn.
      const messages: MessageParam[] = [
        ...history,
        { role: 'user', content: userMessage },
      ];

      // Run the agent loop.
      const { reply, toolsCalled } = await startActiveObservation(
        'agent-loop',
        async (loopSpan) => {
          const result = await runAgentLoop(systemInstruction, messages, userId);
          loopSpan.update({
            output: result.reply,
            metadata: {
              toolsCalled: result.toolsCalled,
              dynamicContext: contextString,
              memorySnapshot: currentMemory,
              ...evalMetadata,
            },
          });
          return result;
        }
      );

      // Set trace output so Langfuse UI shows the final reply.
      rootSpan.update({ output: reply });

      // Fire memory extraction in the background — user already has their reply.
      // Skipped during evals: extraction would mutate the shared eval user's
      // memory mid-run, contaminating later cases and making runs non-reproducible.
      if (!evalMetadata?.skipMemoryExtraction) {
        extractAndSaveMemory(userId, userMessage, reply, currentMemory);
      }

      return { reply, toolsCalled, traceId: rootSpan.traceId, dynamicContext: contextString };
    })
  );
}

export const aiService = {
  chatWithCoach,
};
