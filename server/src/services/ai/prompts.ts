import { workoutService } from '../workout.service';
import { nutritionService } from '../nutrition.service';
import { metricsService } from '../metrics.service';
import { userService } from '../user.service';

export async function buildUserContext(userId: string) {
  const todayStr = new Date().toISOString().split('T')[0];

  // Fire off all database queries in parallel
  const [workouts, nutrition, streaks, profile] = await Promise.all([
    workoutService.getUserWorkouts(userId),
    nutritionService.getNutritionForDate(userId, todayStr),
    metricsService.getStreaks(userId),
    userService.getProfile(userId)
  ]);

  const todayWorkouts = workouts.filter((w: any) =>
    w.startedAt?.toISOString().startsWith(todayStr)
  );

  const goals = profile.goals as any;

  // Extract memory safely and handle both objects and strings
  const memoryArray = ((profile as any).aiMemory as any[]) || [];

  // Filter out expired TTL facts dynamically
  const activeMemory = memoryArray.filter(fact => {
    if (fact && typeof fact === 'object' && fact.expiresAt) {
      const expirationDate = new Date(fact.expiresAt);
      if (!isNaN(expirationDate.getTime()) && expirationDate < new Date()) {
        return false; // Fact has successfully expired
      }
    }
    return true;
  });

  const formattedMemory = activeMemory.length > 0
    ? activeMemory.map(fact => {
      if (typeof fact === 'string') return `- ${fact}`;
      if (fact && typeof fact === 'object' && fact.fact) {
        let factStr = `- ${fact.fact}`;
        if (fact.expiresAt) factStr += ` (Expires: ${fact.expiresAt})`;
        return factStr;
      }
      return `- ${JSON.stringify(fact)}`;
    }).join('\n')
    : "- None currently.";

  // Return a clean, readable string that the LLM can easily understand
  return `
--- LIVE USER DASHBOARD CONTEXT ---
Date: ${todayStr}

KNOWN LONG-TERM FACTS:
${formattedMemory}

Workouts Completed Today: ${todayWorkouts.length}

USER GOALS:
  - Daily Calories: ${goals.calories} kcal
  - Daily Protein: ${goals.proteinG} g
  - Daily Water Intake: ${goals.waterMl} ml
  - Daily Sleep Target: ${goals.sleepHours} hrs

TODAY'S ACTUALS:
  - Calories Consumed: ${nutrition.totals.calories} kcal
  - Protein Consumed: ${nutrition.totals.proteinG} g
  - Carbs: ${nutrition.totals.carbsG} g
  - Fat: ${nutrition.totals.fatG} g

CURRENT STREAKS:
  - Target Hydration: ${streaks.hydration} days
  - Alcohol-Free: ${streaks.alcoholFree} days
-----------------------------------
  `;
}

export const getSystemInstruction = (contextString: string) => `
You are VitalSync Coach, an elite, highly encouraging, and data-driven personal fitness AI. 
You are talking to a user who just asked you a question. 

CRITICAL DIRECTIVE: You MUST relentlessly respect the "KNOWN LONG-TERM FACTS" block. If the user asks about a food they are allergic to, explicitly refuse and warn them. If they ask for a workout that violates an injury, refuse and offer a safe alternative.

Here is their EXACT live dashboard data for today. Use this data strictly to inform your answers. 
If they ask if they can eat something, check their macro room, but ONLY recommend it if it doesn't violate their KNOWN FACTS.
Keep your answers very concise, energetic, and formatted in clean markdown.

${contextString}

---

CRITICAL DIRECTIVE FOR LOGGING:
NEVER call a write tool (like logFood) immediately when a user asks to log something.
When a user asks to log food, you MUST first respond with the estimated macros and explicitly ask them for confirmation.
Example: "Okay, I estimate a large banana has 105 cals, 1g protein, 27g carbs, 0g fat. Shall I log this for breakfast?"
ONLY execute the tool AFTER the user replies "yes" or confirms it in the subsequent message.
`.trim();

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
