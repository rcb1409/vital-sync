import fs from 'fs';
import path from 'path';

import { nutritionService } from '../nutrition.service';
import { metricsService } from '../metrics.service';
import { userService } from '../user.service';
import { prisma } from '@/config/database';
import { langfuseClient } from '@/config/langfuse';

// Cache prompt files at startup (used as fallback when Langfuse is offline)
let cachedPersona = '';
let cachedSafety = '';
let cachedTools = '';

function loadPrompts() {
  const readPrompt = (filename: string): string => {
    let filePath = path.join(__dirname, 'prompts', filename);
    if (!fs.existsSync(filePath)) {
      // Fallback to project root path for development/runtime flexibility
      filePath = path.join(process.cwd(), 'src/services/ai/prompts', filename);
    }
    return fs.readFileSync(filePath, 'utf-8');
  };

  try {
    cachedPersona = readPrompt('persona.md');
    cachedSafety = readPrompt('safety.md');
    cachedTools = readPrompt('tools.md');
  } catch (error) {
    console.error('❌ Failed to load system prompt files:', error);
    cachedPersona = 'You are VitalSync Coach — an elite, data-driven personal fitness AI.';
    cachedSafety = 'Respect user constraints and safety.';
    cachedTools = 'Call tools only when needed.';
  }
}

// Initialize local fallback at module load time
loadPrompts();

/**
 * Builds the AI coach's context from today's data only.
 *
 * Design decision: Only today's snapshot is always-injected.
 * Historical/trend data (7d, 30d) is fetched on-demand via tools
 * (getProgressReport, fetchHistoricalWorkouts) only when the user asks.
 *
 * This keeps the context lean:
 *   - 4 DB queries per chat message (down from 9)
 *   - ~300-400 tokens of context (vs ~800+ with trend data)
 *   - Redis cache can serve today's nutrition + streaks for free
 */
export async function buildUserContext(userId: string) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const todayStart = new Date(`${todayStr}T00:00:00Z`);
  const todayEnd = new Date(`${todayStr}T23:59:59Z`);

  // 4 focused queries, all in parallel
  const [nutrition, streaks, profile, todayWorkoutCount] = await Promise.all([
    // Today's food log totals
    nutritionService.getNutritionForDate(userId, todayStr),

    // Hydration + alcohol-free streaks
    metricsService.getStreaks(userId),

    // User goals + long-term memory facts
    userService.getProfile(userId),

    // Count today's workouts with a date filter (not loading all workouts)
    prisma.workout.count({
      where: {
        userId,
        startedAt: { gte: todayStart, lte: todayEnd },
      },
    }),
  ]);

  const goals = profile.goals as any;

  // Filter out expired TTL memory facts dynamically
  const memoryArray = ((profile as any).aiMemory as any[]) || [];
  const activeMemory = memoryArray.filter(fact => {
    if (fact && typeof fact === 'object' && fact.expiresAt) {
      const expirationDate = new Date(fact.expiresAt);
      if (!isNaN(expirationDate.getTime()) && expirationDate < new Date()) {
        return false; // Expired — drop it
      }
    }
    return true;
  });

  const formattedMemory = activeMemory.length > 0
    ? activeMemory.map(fact => {
        if (typeof fact === 'string') return `- ${fact}`;
        if (fact && typeof fact === 'object' && fact.fact) {
          let str = `- [${fact.category || 'fact'}] ${fact.fact}`;
          if (fact.expiresAt) str += ` (temporary, until ${fact.expiresAt})`;
          return str;
        }
        return `- ${JSON.stringify(fact)}`;
      }).join('\n')
    : '- None currently.';

  return `
--- LIVE USER CONTEXT (Today is ${dayName}, ${todayStr}) ---

KNOWN LONG-TERM FACTS ABOUT THIS USER:
${formattedMemory}

USER DAILY GOALS:
  - Calories: ${goals.calories ?? 2500} kcal
  - Protein: ${goals.proteinG ?? 150} g
  - Water: ${goals.waterMl ?? 3000} ml
  - Sleep: ${goals.sleepHours ?? 8} hrs

TODAY'S ACTUALS:
  - Calories consumed: ${nutrition.totals.calories} kcal
  - Protein consumed: ${Math.round(nutrition.totals.proteinG)} g
  - Carbs: ${Math.round(nutrition.totals.carbsG)} g
  - Fat: ${Math.round(nutrition.totals.fatG)} g
  - Water: ${(nutrition.totals as any).waterMl ?? 0} ml
  - Workouts completed: ${todayWorkoutCount}

CURRENT STREAKS:
  - Hydration streak: ${streaks.hydration} days
  - Alcohol-free streak: ${streaks.alcoholFree} days

NOTE: For weekly trends, historical workouts, or progress reports,
use the available tools — do not guess or make up trend data.
---------------------------------------------------
  `.trim();
}

/**
 * Result of loading the system prompt.
 * - `systemInstruction` is the fully-compiled string sent to Bedrock.
 * - `prompts` exposes the Langfuse prompt clients (or null on fallback) so
 *   callers can link them to generations via `trace.generation({ prompt })`.
 * - `versions` is a flat record useful for trace metadata.
 * - `source` indicates whether content came from Langfuse or the local files.
 */
export interface SystemPromptBundle {
  systemInstruction: string;
  staticPrompt: string;
  prompts: {
    persona: any | null;
    safety: any | null;
    tools: any | null;
  };
  versions: Record<string, number | 'local-fallback'>;
  source: 'langfuse' | 'local';
}

/**
 * Fetch the three Langfuse-managed system prompts (persona / safety / tools)
 * with a `production` label, then assemble the final system instruction.
 *
 * Behavior:
 *   - The Langfuse SDK caches prompts by name+label (default TTL 60s), so
 *     calling this on every chat turn is cheap.
 *   - If the Langfuse client is missing OR any fetch fails, we fall back to
 *     the local .md content loaded at module init. The agent stays online.
 *   - Returned `prompts.persona` is what `ai.service.ts` links to each
 *     generation — Langfuse will then auto-track which prompt version
 *     produced which output, and judges can reference the prompt by version.
 */
export async function getSystemInstruction(contextString: string): Promise<SystemPromptBundle> {
  let personaText = cachedPersona;
  let safetyText = cachedSafety;
  let toolsText = cachedTools;
  let personaPrompt: any | null = null;
  let safetyPrompt: any | null = null;
  let toolsPrompt: any | null = null;
  let source: 'langfuse' | 'local' = 'local';
  const versions: Record<string, number | 'local-fallback'> = {
    persona: 'local-fallback',
    safety: 'local-fallback',
    tools: 'local-fallback',
  };

  if (langfuseClient) {
    try {
      // 5-minute in-process cache. Stale-while-revalidate: after expiry the
      // SDK still returns the cached value immediately and refreshes in the
      // background, so prompt edits in the Langfuse UI propagate within ~5 min
      // without ever adding latency to a user request.
      const PROMPT_CACHE_TTL_SECONDS = 300;
      const [persona, safety, tools] = await Promise.all([
        langfuseClient.prompt.get('vitalsync-persona', { label: 'production', cacheTtlSeconds: PROMPT_CACHE_TTL_SECONDS }),
        langfuseClient.prompt.get('vitalsync-safety', { label: 'production', cacheTtlSeconds: PROMPT_CACHE_TTL_SECONDS }),
        langfuseClient.prompt.get('vitalsync-tools', { label: 'production', cacheTtlSeconds: PROMPT_CACHE_TTL_SECONDS }),
      ]);

      // SDK returns TextPromptClient | ChatPromptClient. We seed all three as
      // text-type prompts, so this narrowing is safe — but guard anyway.
      if (persona.type === 'text' && safety.type === 'text' && tools.type === 'text') {
        personaPrompt = persona;
        safetyPrompt = safety;
        toolsPrompt = tools;
        personaText = persona.prompt;
        safetyText = safety.prompt;
        toolsText = tools.prompt;
        versions.persona = persona.version;
        versions.safety = safety.version;
        versions.tools = tools.version;
        source = 'langfuse';
      } else {
        console.warn('⚠️  Unexpected non-text prompt type from Langfuse — using local fallback');
      }
    } catch (err) {
      console.warn(
        '⚠️  Failed to fetch system prompts from Langfuse — using local .md fallback:',
        (err as Error).message
      );
    }
  }

  // Static portion: persona + safety + tools (no dynamic user data).
  // Used by evaluators like Out-of-Scope that need to know the coach's
  // defined role and boundaries without the per-user noise.
  const staticPrompt = `${personaText}\n\n${safetyText}\n\n${toolsText}`.trim();

  const systemInstruction = `
${staticPrompt}

--- DYNAMIC USER DATA ---
${contextString}
`.trim();

  return {
    systemInstruction,
    staticPrompt,
    prompts: { persona: personaPrompt, safety: safetyPrompt, tools: toolsPrompt },
    versions,
    source,
  };
}

/**
 * Prompt for the separate, focused Memory Extractor LLM call.
 * This runs AFTER the main agent has already replied to the user.
 * It has NO tools registered, so responseMimeType: 'application/json' works perfectly.
 */
export const getMemoryExtractionPrompt = (
  userMessage: string,
  aiResponse: string,
  currentMemory: any[],
  todayStr: string
) => `
You are a memory management system for a fitness app.
Your ONLY job is to analyze a conversation and return an updated list of long-term facts about the user.

Today's date: ${todayStr}

CURRENT SAVED FACTS:
${JSON.stringify(currentMemory, null, 2)}

CONVERSATION:
User: ${userMessage}
AI Coach: ${aiResponse}

INSTRUCTIONS:
1. If the user mentioned a new permanent fact (allergy, preference, injury), ADD it with "expiresAt": null.
2. If the user mentioned a temporary condition with a timeframe (e.g. "sick for 3 days", "on a trip until Friday"), ADD it and calculate the ISO expiration date from today.
3. KEEP all existing facts that are still valid.
4. REMOVE any fact the user explicitly said is no longer true.
5. If nothing changed, return the existing facts unchanged.

Return ONLY a JSON array of facts. No explanation, no markdown.
`.trim();

