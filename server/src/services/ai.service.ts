
import { GoogleGenerativeAI, SchemaType, FunctionDeclaration } from '@google/generative-ai';
import { env } from '../config/env';
import { workoutService } from './workout.service';
import { nutritionService } from './nutrition.service';
import { metricsService } from './metrics.service';
import { userService } from './user.service';
import { prisma } from '@/config/database';
import { validateAiResponse } from '@/validators/ai.validator';

// 1. Initialize the Google SDK with your secure API key
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Grabs the user's Live Dashboard Data and returns it as a formatted string.
 * This is the exact same logic our GraphQL resolver uses!
 */
async function buildUserContext(userId: string) {
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

const fetchHistoricalWorkoutsDeclaration: FunctionDeclaration = {
  name: "fetchHistoricalWorkouts",
  description: "Fetches the user's past workouts between a specific start and end date. Use this tool ONLY when the user asks about historical workouts outside of today.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      startDate: {
        type: SchemaType.STRING,
        description: "The start date in YYYY-MM-DD format (e.g., '2026-03-30')."
      },
      endDate: {
        type: SchemaType.STRING,
        description: "The end date in YYYY-MM-DD format (e.g., '2026-04-05')."
      },
    },
    required: ["startDate", "endDate"]
  }
};

const logFoodDeclaration: FunctionDeclaration = {
  name: "logFood",
  description: "Logs a food item to the user's daily nutrition tracking. Use this when the user explicitly mentions eating something or asks to log food. Estimate the macros accurately if they don't provide them.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      foodName: { type: SchemaType.STRING, description: "Name of the food (e.g., '1 Large Banana')" },
      calories: { type: SchemaType.NUMBER, description: "Estimated total calories" },
      proteinG: { type: SchemaType.NUMBER, description: "Estimated protein in grams" },
      carbsG: { type: SchemaType.NUMBER, description: "Estimated carbs in grams" },
      fatG: { type: SchemaType.NUMBER, description: "Estimated fat in grams" },
      mealType: { type: SchemaType.STRING, description: "Must be exactly: 'breakfast', 'lunch', 'dinner', or 'snack'" },
    },
    required: ["foodName", "calories", "proteinG", "carbsG", "fatG", "mealType"]
  }
};

/**
 * The main function that talks to Gemini
 */
async function chatWithCoach(userId: string, userMessage: string, history: any[] = []) {

  // 1. Get the live context
  const contextString = await buildUserContext(userId);

  // 2. Define the System Instruction (The AI's "Personality" and "Memory")
  const systemInstruction = `
You are VitalSync Coach, an elite, highly encouraging, and data-driven personal fitness AI. 
You are talking to a user who just asked you a question. 

CRITICAL DIRECTIVE: You MUST relentlessly respect the "KNOWN LONG-TERM FACTS" block. If the user asks about a food they are allergic to, explicitly refuse and warn them. If they ask for a workout that violates an injury, refuse and offer a safe alternative.

Here is their EXACT live dashboard data for today. Use this data strictly to inform your answers. 
If they ask if they can eat something, check their macro room, but ONLY recommend it if it doesn't violate their KNOWN FACTS.
Keep your answers very concise, energetic, and formatted in clean markdown.

${contextString}

---

INSTRUCTIONS FOR MANAGING MEMORY (TTL Feature Active):
Review the CURRENT SAVED FACTS in the context string above. 
1. If the user mentions a new fact (dietary preference, injury, rule, etc), ADD it.
2. If the user explicitly gives a timeline for a temporary condition (e.g., "I'm sick for the next 3 days", "On a trip until Friday"), calculate the expiration date using the Date provided in the context, and set 'expiresAt' as an ISO timestamp string. For permanent facts, set 'expiresAt' to null.
3. KEEP passing forward all existing facts exactly as they appear in the KNOWN FACTS context. Do not drop existing facts unless the user specifically states they are no longer true.

CRITICAL DIRECTIVE FOR LOGGING:
NEVER call a write tool (like logFood) immediately when a user asks to log something.
When a user asks to log food, you MUST first respond with the estimated macros and explicitly ask them for confirmation.
Example: "Okay, I estimate a large banana has 105 cals, 1g protein, 27g carbs, 0g fat. Shall I log this for breakfast?"
ONLY execute the tool AFTER the user replies "yes" or confirms it in the subsequent message.

You MUST completely output your response as a JSON object strictly matching this schema:
{
  "messageToUser": "Your conversational, energetic, and concise response to the user's message here.",
  "aiMemory": [
    { "fact": "User is allergic to strawberries", "expiresAt": null },
    { "fact": "User is sick with the flu", "expiresAt": "2026-04-09T00:00:00.000Z" }
  ]
}

Ensure "aiMemory" contains the comprehensive, dynamically updated list of all active facts.
  `.trim();

  // 3. Initialize the specific Gemini Model (gemini-2.5-flash is the fastest and cheapest)
  const model = genAI.getGenerativeModel(
    {
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
      tools: [
        {
          functionDeclarations: [fetchHistoricalWorkoutsDeclaration, logFoodDeclaration]
        }
      ]
      // Note: The Gemini API throws a 400 Error if you use 'application/json' while tools are active!
      // We must rely entirely on our system prompt to enforce the JSON structure.
    },
    env.HELICONE_API_KEY
      ? {
          baseUrl: "https://gateway.helicone.ai",
          customHeaders: {
            "Helicone-Auth": `Bearer ${env.HELICONE_API_KEY}`,
            "Helicone-Target-Url": "https://generativelanguage.googleapis.com",
            "Helicone-User-Id": userId,
          },
        }
      : undefined
  );

  // 4.Initialize the global Chat Session with the sliding window history!
  const chat = model.startChat({
    history: history
  })
  const result = await chat.sendMessage(userMessage);
  const functionCalls = result.response.functionCalls();

  // ==========================================
  // PASS 1: INTERCEPT TOOL CALLS
  // ==========================================
  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];

    if (call.name == "fetchHistoricalWorkouts") {
      const { startDate, endDate } = call.args as { startDate: string, endDate: string };
      console.log(`Executing Tool on Server -> Fetching workouts from ${startDate} to ${endDate}`);

      const allWorkouts = await workoutService.getUserWorkouts(userId);
      const requestedWorkouts = allWorkouts.filter(w => {
        const dateString = new Date(w.startedAt).toISOString().split('T')[0];
        return dateString >= startDate && dateString <= endDate;
      });

      const finalResult = await chat.sendMessage([{
        functionResponse: {
          name: "fetchHistoricalWorkouts",
          response: { retrievedWorkouts: requestedWorkouts }
        }
      }]);

      try {
        let rawText = finalResult.response.text();
        // Since we can't force 'application/json', Gemini might wrap it in markdown blocksticks. Let's strip them safely:
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedFinal = JSON.parse(rawText);
        return parsedFinal.messageToUser;
      } catch (err) {
        console.error("Failed to parse tool JSON response:", err);
        return finalResult.response.text();
      }
    } else if (call.name == "logFood") {
      const args = call.args as { foodName: string, calories: number, proteinG: number, carbsG: number, fatG: number, mealType: "breakfast" | "lunch" | "dinner" | "snack" };
      console.log(`Executing Tool on Server -> Logging Food: ${args.foodName} (${args.calories} cal)`);

      const todayStr = new Date().toISOString().split('T')[0];

      // Execute the genuine database write!
      await nutritionService.logFood({
        userId,
        foodName: args.foodName,
        calories: args.calories,
        proteinG: args.proteinG,
        carbsG: args.carbsG,
        fatG: args.fatG,
        mealType: args.mealType,
        date: todayStr
      });

      // Hand the success response back to Gemini so it knows the deed is done
      const finalResult = await chat.sendMessage([{
        functionResponse: {
          name: "logFood",
          response: { success: true, message: `Successfully logged ${args.foodName} to database.` }
        }
      }]);

      try {
        let rawText = finalResult.response.text();
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedFinal = JSON.parse(rawText);
        return parsedFinal.messageToUser;
      } catch (err) {
        console.error("Failed to parse tool JSON response:", err);
        return finalResult.response.text();
      }
    }
  }

  // ==========================================
  // PASS 2: STANDARD CHAT (No Tools Requested)
  // ==========================================
  try {
    let rawText = result.response.text();
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(rawText);

      // Overwrite Database synchronously with the dynamically updated memory sheet
      if (parsed.aiMemory && Array.isArray(parsed.aiMemory)) {
        await prisma.user.update({
          where: { id: userId },
          data: { aiMemory: parsed.aiMemory }
        });
        console.log("Memory Extracted & Saved (TTL Supported):", parsed.aiMemory);
      }

      return parsed.messageToUser || rawText;
    } catch (parseError) {
      // If Gemini got distracted by the logFood rule and simply output English text instead of JSON,
      // we don't want to crash! We just gracefully return the raw English text.
      return rawText;
    }
  } catch (error) {
    console.error("Failed to extract text from response:", error);
    return "Oops! Let's try that again. Something went slightly wrong with my system update.";
  }
}

export const aiService = {
  chatWithCoach,
};
