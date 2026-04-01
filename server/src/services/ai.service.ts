// server/src/services/ai.service.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { workoutService } from './workout.service';
import { nutritionService } from './nutrition.service';
import { metricsService } from './metrics.service';

// 1. Initialize the Google SDK with your secure API key
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Grabs the user's Live Dashboard Data and returns it as a formatted string.
 * This is the exact same logic our GraphQL resolver uses!
 */
async function buildUserContext(userId: string) {
    const todayStr = new Date().toISOString().split('T')[0];

    // Fire off all database queries in parallel
    const [workouts, nutrition, streaks] = await Promise.all([
        workoutService.getUserWorkouts(userId),
        nutritionService.getNutritionForDate(userId, todayStr),
        metricsService.getStreaks(userId),
    ]);

    const todayWorkouts = workouts.filter((w: any) =>
        w.startedAt?.toISOString().startsWith(todayStr)
    );

    // Return a clean, readable string that the LLM can easily understand
    return `
--- LIVE USER DASHBOARD CONTEXT ---
Date: ${todayStr}
Workouts Completed Today: ${todayWorkouts.length}
Today's Nutrition:
  - Calories: ${nutrition.totals.calories} 
  - Protein: ${nutrition.totals.proteinG}g
  - Carbs: ${nutrition.totals.carbsG}g
  - Fat: ${nutrition.totals.fatG}g
Current Streaks:
  - Hydration (2000ml+): ${streaks.hydration} days
  - Alcohol-Free: ${streaks.alcoholFree} days
-----------------------------------
  `;
}

/**
 * The main function that talks to Gemini
 */
async function chatWithCoach(userId: string, userMessage: string) {
    // 1. Get the live context
    const contextString = await buildUserContext(userId);

    // 2. Define the System Instruction (The AI's "Personality" and "Memory")
    const systemInstruction = `
You are VitalSync Coach, an elite, highly encouraging, and data-driven personal fitness AI. 
You are talking to a user who just asked you a question. 

Here is their EXACT live dashboard data for today. Use this data strictly to inform your answers. 
If they ask if they can eat something, check their live macros. If they ask about their streaks, praise them.
Keep your answers very concise, energetic, and formatted in clean markdown.

${contextString}
  `.trim();

    // 3. Initialize the specific Gemini Model (gemini-2.5-flash is the fastest and cheapest)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction,
    });

    // 4. Send the message to Google and wait for the response
    const result = await model.generateContent(userMessage);

    return result.response.text();
}

export const aiService = {
    chatWithCoach,
};
