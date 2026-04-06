// server/src/graphql/resolvers.ts
import { workoutService } from '../services/workout.service';
import { nutritionService } from '../services/nutrition.service';
import { metricsService } from '../services/metrics.service';

export const resolvers = {
    Query: {
        getDashboardSummary: async (_: any, __: any, context: any) => {
            // 1. Get the user ID from the Context (we will set this up in Step 4)
            const userId = context.user.userId;

            // We need today's date formatted as YYYY-MM-DD
            const todayStr = new Date().toISOString().split('T')[0];

            // 2. Fire off all database queries at the EXACT SAME TIME for speed!
            const [workouts, nutrition, streaks, weightHistory, todayHabit] = await Promise.all([
                workoutService.getUserWorkouts(userId),      // Did they workout today?
                nutritionService.getNutritionForDate(userId, todayStr),   // Today's macros
                metricsService.getStreaks(userId),         // Hydration/Alcohol streaks
                metricsService.getWeightHistory(userId, 7), // Weight trend
                metricsService.getHabitForDate(userId, todayStr) // Today's water
            ]);

            // 3. Package it into the exact shape we promised in the Schema (Step 2)
            return {
                todayWorkouts: workouts.filter((w: any) => w.startedAt?.toISOString().startsWith(todayStr)).length,
                macros: {
                    calories: nutrition.totals.calories,
                    proteinG: nutrition.totals.proteinG,
                    carbsG: nutrition.totals.carbsG,
                    fatG: nutrition.totals.fatG,
                    waterMl: todayHabit?.waterMl || 0
                },
                streaks: {
                    hydration: streaks.hydration,
                    alcoholFree: streaks.alcoholFree
                },
                currentWeightEma: weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].emaWeight : null
            };
        }
    }
};
