import fs from 'fs';
import path from 'path';

import { nutritionService } from '../nutrition.service';
import { userService } from '../user.service';
import { prisma } from '@/config/database';
import { langfuseClient } from '@/config/langfuse';
import { healthSummaryService } from '../healthSummary.service';
import { healthAnalysisService, type RecentHealthData, type HealthBaselines } from '../healthAnalysis.service';
import { healthMetricsService, type SleepData } from '../healthMetrics.service';

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
 * Builds the AI coach's context from today's data and weekly health summary.
 *
 * Includes:
 *   - Today's nutrition and workout count
 *   - Last night's sleep with computed sleep score
 *   - Weekly health summary (recovery score, trends, training load)
 *   - Active health anomalies/alerts
 *   - User goals and long-term memory facts
 *
 * Historical/trend data (7d, 30d) is fetched on-demand via tools
 * (fetchHealthHistory) only when the user asks for specifics.
 */
export async function buildUserContext(userId: string) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const todayStart = new Date(`${todayStr}T00:00:00Z`);
  const todayEnd = new Date(`${todayStr}T23:59:59Z`);

  const sixteenHoursAgo = new Date(Date.now() - 16 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all data in parallel
  const [
    nutrition,
    profile,
    todayWorkoutCount,
    lastSleepPoint,
    weeklySummary,
    recentSleep,
    recentHRV,
    recentRHR,
    recentExercise,
    recentSteps,
  ] = await Promise.all([
    // Today's food log totals
    nutritionService.getNutritionForDate(userId, todayStr),

    // User goals + long-term memory facts
    userService.getProfile(userId),

    // Count today's Google Health exercise sessions
    prisma.healthDataPoint.count({
      where: { userId, dataType: 'exercise', recordedAt: { gte: todayStart, lte: todayEnd } },
    }),

    // Most recent sleep session (ended within last 16 hrs = last night)
    prisma.healthDataPoint.findFirst({
      where:   { userId, dataType: 'sleep', recordedAt: { gte: sixteenHoursAgo } },
      orderBy: { recordedAt: 'desc' },
    }),

    // Weekly health summary (pre-computed)
    healthSummaryService.getHealthSummary(userId, 'weekly'),

    // Recent data for anomaly detection (last 7 days)
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'sleep', recordedAt: { gte: sevenDaysAgo } },
      orderBy: { recordedAt: 'desc' },
      take: 7,
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'hrv', recordedAt: { gte: sevenDaysAgo } },
      orderBy: { recordedAt: 'desc' },
      take: 7,
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'resting_hr', recordedAt: { gte: sevenDaysAgo } },
      orderBy: { recordedAt: 'desc' },
      take: 7,
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'exercise', recordedAt: { gte: sevenDaysAgo } },
      orderBy: { recordedAt: 'desc' },
      take: 14,
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'steps', recordedAt: { gte: sevenDaysAgo } },
      orderBy: { recordedAt: 'desc' },
      take: 7,
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

  // Format last night's sleep with score
  const lastSleepValue = lastSleepPoint?.value as SleepData | null;
  const lastSleepMinutes = lastSleepValue?.durationMinutes ?? null;
  const lastSleepScore = lastSleepValue
    ? healthMetricsService.computeSleepScoreSafe(lastSleepValue)
    : null;
  const lastSleepStr = lastSleepMinutes
    ? `${Math.floor(lastSleepMinutes / 60)}h ${lastSleepMinutes % 60}m (score: ${lastSleepScore ?? 'N/A'}/100)`
    : 'No data yet';

  // Build recovery status section
  let recoverySection = '';
  if (weeklySummary) {
    recoverySection = `
RECOVERY STATUS (7-day):
  - Recovery Score: ${weeklySummary.latestRecoveryScore}/100
  - HRV (avg): ${weeklySummary.avgHRV > 0 ? `${Math.round(weeklySummary.avgHRV)} ms` : 'N/A'}
  - Resting HR (avg): ${weeklySummary.avgRestingHR > 0 ? `${Math.round(weeklySummary.avgRestingHR)} bpm` : 'N/A'}
  - Recovery Trend: ${weeklySummary.recoveryTrend}`;
  }

  // Build weekly training section
  let trainingSection = '';
  if (weeklySummary) {
    const load = weeklySummary.weeklyTrainingLoad;
    trainingSection = `
WEEKLY TRAINING (7-day):
  - Workouts: ${weeklySummary.workoutCount}
  - Total Minutes: ${load?.totalMinutes ?? 0}
  - Avg Sleep Score: ${weeklySummary.avgSleepScore > 0 ? `${Math.round(weeklySummary.avgSleepScore)}/100` : 'N/A'}
  - Sleep Trend: ${weeklySummary.sleepTrend}
  - Avg Daily Steps: ${weeklySummary.avgDailySteps > 0 ? weeklySummary.avgDailySteps.toLocaleString() : 'N/A'}`;
  }

  // Detect anomalies
  const recentData: RecentHealthData = {
    sleep: recentSleep.map(s => s.value as unknown as SleepData),
    hrv: recentHRV.map(h => h.value as any),
    rhr: recentRHR.map(r => r.value as any),
    exercise: recentExercise.map(e => e.value as any),
    steps: recentSteps.map(s => s.value as any),
  };

  const baselines: HealthBaselines = {
    sleepScore: weeklySummary?.avgSleepScore ?? 0,
    hrv: weeklySummary?.avgHRV ?? 0,
    rhr: weeklySummary?.avgRestingHR ?? 0,
    dailySteps: weeklySummary?.avgDailySteps ?? 0,
  };

  const anomalies = healthAnalysisService.detectAnomaliesSafe(recentData, baselines);
  const anomalySection = anomalies.length > 0
    ? `
HEALTH ALERTS:
${anomalies.map(a => `  - [${a.severity.toUpperCase()}] ${a.message}`).join('\n')}`
    : '';

  return `
--- LIVE USER CONTEXT (Today is ${dayName}, ${todayStr}) ---

KNOWN LONG-TERM FACTS ABOUT THIS USER:
${formattedMemory}

USER DAILY GOALS:
  - Calories: ${goals.calorie_target ?? goals.calories ?? 2500} kcal
  - Protein:  ${goals.protein_target ?? goals.proteinG ?? 150} g
  - Target weight: ${goals.target_weight ?? 'not set'} kg

TODAY'S ACTUALS:
  - Calories consumed:  ${nutrition.totals.calories} kcal
  - Protein consumed:   ${Math.round(nutrition.totals.proteinG)} g
  - Carbs:              ${Math.round(nutrition.totals.carbsG)} g
  - Fat:                ${Math.round(nutrition.totals.fatG)} g
  - Workouts completed: ${todayWorkoutCount}
  - Last night's sleep: ${lastSleepStr}
${recoverySection}
${trainingSection}
${anomalySection}

NOTE: For detailed historical data, use the fetchHealthHistory tool.
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

