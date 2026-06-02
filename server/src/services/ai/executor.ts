import { workoutService } from '../workout.service';
import { nutritionService } from '../nutrition.service';
import { metricsService } from '../metrics.service';
import { prisma } from '@/config/database';
import { env } from '@/config/env';

/**
 * Provider-agnostic shape for a tool invocation.
 * Both Gemini's `FunctionCall` and Anthropic's `tool_use` block can be mapped
 * to this — keeps the executor independent of which LLM produced the call.
 */
export type ToolCall = { name: string; args: Record<string, any> };

/**
 * Classifies an error into either:
 * - Semantic (model passed bad args — it can retry with corrected values)
 * - System   (infrastructure failure — model cannot fix it, sanitize for user safety)
 */
export function classifyError(err: unknown): { success: false; error: string; canRetry: boolean } {
  const message = (err as Error).message ?? '';

  // Semantic errors: bad arguments the model caused and can correct
  const isSemanticError =
    message.includes('Invalid') ||
    message.includes('required') ||
    message.includes('must be') ||
    message.includes('format') ||
    message.includes('Unknown tool call');

  if (isSemanticError) {
    return {
      success: false,
      error: message,  // Safe to pass — describes the argument problem, not DB internals
      canRetry: true
    };
  }

  // System errors: DB, network, server — log full error server-side, send generic message to model
  console.error('[Tool System Error — not exposed to user]', err);
  return {
    success: false,
    error: 'The action could not be completed due to a temporary issue. Please try again shortly.',
    canRetry: false
  };
}

export async function executeToolCall(userId: string, call: ToolCall) {
  if (call.name === "fetchHistoricalWorkouts") {
    const { startDate, endDate } = call.args as { startDate: string, endDate: string };

    // Validate args before hitting the DB — produces a semantic error the model can fix
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new Error(`Invalid date format. Expected YYYY-MM-DD, received startDate="${startDate}", endDate="${endDate}".`);
    }

    console.log(`Executing Tool on Server -> Fetching workouts from ${startDate} to ${endDate}`);

    // Use the date-filtered DB query instead of loading everything + JS filter
    const requestedWorkouts = await workoutService.getUserWorkoutsByDateRange(userId, startDate, endDate);

    return { retrievedWorkouts: requestedWorkouts };
  }

  if (call.name === "logFood") {
    const args = call.args as {
      foodName: string;
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      mealType: "breakfast" | "lunch" | "dinner" | "snack";
    };

    // Validate mealType before hitting the DB — produces a semantic error the model can fix
    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(args.mealType)) {
      throw new Error(`Invalid mealType "${args.mealType}". Must be one of: breakfast, lunch, dinner, snack.`);
    }

    console.log(`Executing Tool on Server -> Logging Food: ${args.foodName} (${args.calories} cal)`);

    const todayStr = new Date().toISOString().split('T')[0];
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

    return { success: true, message: `Successfully logged ${args.foodName} to database.` };
  }

  if (call.name === "searchExercises") {
    const { muscleGroup } = call.args as { muscleGroup: string };
    const validMuscles = ["chest", "back", "shoulders", "biceps", "triceps", "legs", "core", "cardio"];
    if (!validMuscles.includes(muscleGroup)) {
      throw new Error(`Invalid muscleGroup "${muscleGroup}". Must be one of: ${validMuscles.join(', ')}.`);
    }
    console.log(`Executing Tool on Server -> Searching exercises for: ${muscleGroup}`);

    const exercises = await prisma.exercise.findMany({
      where: { muscleGroup: muscleGroup as any },
      select: { id: true, name: true, equipment: true }
    });
    return { exercises }

  }

  if (call.name === "createWorkoutTemplate") {
    // Notice we extract the complex array including restSeconds
    const { templateName, exercises } = call.args as {
      templateName: string,
      exercises: { exerciseId: number, sets: number, reps: number, restSeconds: number }[]
    };

    if (!Array.isArray(exercises) || exercises.length === 0) {
      throw new Error(`Invalid exercises array. Must provide an array of at least one exercise.`);
    }

    console.log(`Executing Tool on Server -> Creating template "${templateName}" with ${exercises.length} exercises`);

    // Map into the JSON format Prisma will save
    const exercisesJson = exercises.map(ex => ({
      exercise_id: ex.exerciseId,
      sets: ex.sets,
      reps: ex.reps,
      rest_seconds: ex.restSeconds || 120,
      weight: 0
    }));

    const newTemplate = await prisma.workoutTemplate.create({
      data: {
        userId: userId,
        name: templateName,
        exercises: exercisesJson
      }
    });

    return { 
      success: true, 
      templateId: newTemplate.id,
      message: `Successfully created template '${templateName}'. Structural template only (weights left null for live UI tracking).`
    };
  }


  if (call.name === "logWeight") {
    const { weightKg } = call.args as { weightKg: number };
    
    if (typeof weightKg !== 'number' || weightKg <= 0 || weightKg > 500) {
      throw new Error(`Invalid weight. Expected a positive number (in kg), received ${weightKg}.`);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    console.log(`Executing Tool on Server -> Logging weight ${weightKg}kg for ${todayStr}`);

    await metricsService.logWeight({
      userId,
      weightKg,
      date: todayStr
    });

    return { 
      success: true, 
      message: `Successfully logged weight as ${weightKg}kg for today.` 
    };
  }

  if (call.name === "webSearch") {
    const { query } = call.args as { query: string };
    console.log(`Executing Tool on Server -> Web Search for: "${query}"`);

    if (!env.TAVILY_API_KEY) {
      throw new Error("TAVILY_API_KEY is not configured. Ask the user to configure it in their environment.");
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query: query,
          search_depth: "basic",
          include_answer: true,
          max_results: 3
        })
      });

      if (!response.ok) {
        throw new Error(`Tavily API responded with status ${response.status}`);
      }

      const data = await response.json() as any;
      return { 
        success: true, 
        answer: data.answer,
        results: data.results.map((r: any) => ({ title: r.title, content: r.content, url: r.url }))
      };
    } catch (e: any) {
      throw new Error(`Failed to perform web search: ${e.message}`);
    }
  }

  throw new Error(`Unknown tool call: ${call.name}`);
}
