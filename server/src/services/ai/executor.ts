import { workoutService } from '../workout.service';
import { nutritionService } from '../nutrition.service';
import { FunctionCall } from '@google/generative-ai';

export async function executeToolCall(userId: string, call: FunctionCall) {
  if (call.name === "fetchHistoricalWorkouts") {
    const { startDate, endDate } = call.args as { startDate: string, endDate: string };
    console.log(`Executing Tool on Server -> Fetching workouts from ${startDate} to ${endDate}`);

    const allWorkouts = await workoutService.getUserWorkouts(userId);
    const requestedWorkouts = allWorkouts.filter((w: any) => {
      const dateString = new Date(w.startedAt).toISOString().split('T')[0];
      return dateString >= startDate && dateString <= endDate;
    });

    return { retrievedWorkouts: requestedWorkouts };
  } 
  
  if (call.name === "logFood") {
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

    return { success: true, message: `Successfully logged ${args.foodName} to database.` };
  }

  throw new Error(`Unknown tool call: ${call.name}`);
}
