import { workoutService } from '../workout.service';
import { nutritionService } from '../nutrition.service';
import { FunctionCall } from '@google/generative-ai';
import { prisma } from '@/config/database';

/**
 * Classifies an error into either:
 * - Semantic (Gemini passed bad args — it can retry with corrected values)
 * - System   (infrastructure failure — Gemini cannot fix it, sanitize for user safety)
 */
export function classifyError(err: unknown): { success: false; error: string; canRetry: boolean } {
  const message = (err as Error).message ?? '';

  // Semantic errors: bad arguments that Gemini caused and can correct
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

  // System errors: DB, network, server — log full error server-side, send generic message to Gemini
  console.error('[Tool System Error — not exposed to user]', err);
  return {
    success: false,
    error: 'The action could not be completed due to a temporary issue. Please try again shortly.',
    canRetry: false
  };
}

export async function executeToolCall(userId: string, call: FunctionCall) {
  if (call.name === "fetchHistoricalWorkouts") {
    const { startDate, endDate } = call.args as { startDate: string, endDate: string };

    // Validate args before hitting the DB — produces a semantic error Gemini can fix
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new Error(`Invalid date format. Expected YYYY-MM-DD, received startDate="${startDate}", endDate="${endDate}".`);
    }

    console.log(`Executing Tool on Server -> Fetching workouts from ${startDate} to ${endDate}`);

    const allWorkouts = await workoutService.getUserWorkouts(userId);
    const requestedWorkouts = allWorkouts.filter((w: any) => {
      const dateString = new Date(w.startedAt).toISOString().split('T')[0];
      return dateString >= startDate && dateString <= endDate;
    });

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

    // Validate mealType before hitting the DB — produces a semantic error Gemini can fix
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


  throw new Error(`Unknown tool call: ${call.name}`);
}
