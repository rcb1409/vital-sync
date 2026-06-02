// server/src/graphql/resolvers.ts
import { workoutService } from '../services/workout.service';
import { nutritionService } from '../services/nutrition.service';
import { metricsService } from '../services/metrics.service';
import { prisma } from '../config/database';

export const resolvers = {
    Query: {
        getDashboardSummary: async (_: any, args: { rangeDays?: number }, context: any) => {
            const userId = context.user.userId;
            const rangeDays = args.rangeDays || 30;

            const todayStr = new Date().toISOString().split('T')[0];

            // Calculate date boundaries
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - rangeDays);

            // Fire off all database queries in parallel
            const [workouts, nutrition, streaks, weightHistory, todayHabit, nutritionLogs, recentWorkouts, profile] = await Promise.all([
                workoutService.getUserWorkouts(userId),
                nutritionService.getNutritionForDate(userId, todayStr),
                metricsService.getStreaks(userId),
                metricsService.getWeightHistory(userId, rangeDays),
                metricsService.getHabitForDate(userId, todayStr),
                // Nutrition logs for chart (daily calories over range)
                prisma.nutritionLog.findMany({
                    where: { userId, date: { gte: cutoffDate } },
                    orderBy: { date: 'asc' },
                }),
                // Workouts with sets for volume chart
                prisma.workout.findMany({
                    where: { userId, startedAt: { gte: cutoffDate } },
                    include: { sets: { include: { exercise: true } } },
                }),
                // User profile for calorie target
                prisma.user.findUnique({
                    where: { id: userId },
                    select: { goals: true },
                }),
            ]);

            const goals = (profile?.goals as any) || {};
            const calorieTarget = goals.calories || 2500;

            // ---- Chart Data: Daily Calories ----
            const caloriesByDate = new Map<string, number>();
            for (const log of nutritionLogs) {
                const dateKey = log.date.toISOString().split('T')[0];
                caloriesByDate.set(dateKey, (caloriesByDate.get(dateKey) || 0) + log.calories);
            }
            const dailyCalories = Array.from(caloriesByDate.entries())
                .map(([date, calories]) => ({ date, calories, target: calorieTarget }))
                .sort((a, b) => a.date.localeCompare(b.date));

            // ---- Chart Data: Macro Breakdown (today) ----
            const macroBreakdown = {
                protein: Number(nutrition.totals.proteinG) || 0,
                carbs: Number(nutrition.totals.carbsG) || 0,
                fat: Number(nutrition.totals.fatG) || 0,
            };

            // ---- Chart Data: Weekly Volume by Muscle Group ----
            const volumeByMuscle = new Map<string, number>();
            for (const workout of recentWorkouts) {
                for (const set of (workout as any).sets) {
                    const muscleGroup = set.exercise?.muscleGroup || 'other';
                    const volume = set.reps * Number(set.weightKg);
                    volumeByMuscle.set(
                        muscleGroup,
                        (volumeByMuscle.get(muscleGroup) || 0) + volume
                    );
                }
            }
            const weeklyVolume = Array.from(volumeByMuscle.entries())
                .map(([muscleGroup, volume]) => ({ muscleGroup, volume: Math.round(volume) }))
                .sort((a, b) => b.volume - a.volume);

            // ---- Chart Data: Weight Trend ----
            const weightTrend = weightHistory.map((entry: any) => ({
                date: new Date(entry.date).toISOString().split('T')[0],
                rawWeight: entry.rawWeight,
                emaWeight: entry.emaWeight,
            }));

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
                currentWeightEma: weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].emaWeight : null,
                charts: {
                    weightTrend,
                    dailyCalories,
                    macroBreakdown,
                    weeklyVolume,
                },
            };
        }
    }
};
