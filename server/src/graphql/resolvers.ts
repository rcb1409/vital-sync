import { nutritionService } from '../services/nutrition.service';
import { metricsService } from '../services/metrics.service';
import { prisma } from '../config/database';

export const resolvers = {
    Query: {
        getDashboardSummary: async (_: any, args: { rangeDays?: number }, context: any) => {
            const userId    = context.user.userId;
            const rangeDays = args.rangeDays || 30;

            const todayStr   = new Date().toISOString().split('T')[0];
            const todayStart = new Date(`${todayStr}T00:00:00Z`);
            const todayEnd   = new Date(`${todayStr}T23:59:59Z`);

            // Last night = sleep that ended in the past 16 hours
            const sixteenHoursAgo = new Date(Date.now() - 16 * 60 * 60 * 1000);

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - rangeDays);

            const [nutrition, weightHistory, nutritionLogs, todayWorkouts, lastSleepPoint, profile] = await Promise.all([
                nutritionService.getNutritionForDate(userId, todayStr),
                metricsService.getWeightHistory(userId, rangeDays),
                prisma.nutritionLog.findMany({
                    where:   { userId, date: { gte: cutoffDate } },
                    orderBy: { date: 'asc' },
                }),
                // Today's workouts from Google Health
                prisma.healthDataPoint.count({
                    where: { userId, dataType: 'exercise', recordedAt: { gte: todayStart, lte: todayEnd } },
                }),
                // Most recent sleep session that ended in the last 16 hours
                prisma.healthDataPoint.findFirst({
                    where:   { userId, dataType: 'sleep', recordedAt: { gte: sixteenHoursAgo } },
                    orderBy: { recordedAt: 'desc' },
                }),
                prisma.user.findUnique({
                    where:  { id: userId },
                    select: { goals: true },
                }),
            ]);

            const goals         = (profile?.goals as any) || {};
            const calorieTarget = goals.calorie_target || goals.calories || 2500;

            // Last-night sleep minutes — read from the JSON value stored by the sync
            const lastNightSleepMinutes: number | null = lastSleepPoint
                ? ((lastSleepPoint.value as any)?.durationMinutes ?? null)
                : null;

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
                carbs:   Number(nutrition.totals.carbsG)   || 0,
                fat:     Number(nutrition.totals.fatG)     || 0,
            };

            // ---- Chart Data: Weight Trend ----
            const weightTrend = weightHistory.map((entry: any) => ({
                date:      new Date(entry.date).toISOString().split('T')[0],
                rawWeight: entry.rawWeight,
                emaWeight: entry.emaWeight,
            }));

            return {
                todayWorkouts,
                lastNightSleepMinutes,
                macros: {
                    calories: nutrition.totals.calories,
                    proteinG: nutrition.totals.proteinG,
                    carbsG:   nutrition.totals.carbsG,
                    fatG:     nutrition.totals.fatG,
                },
                currentWeightEma: weightHistory.length > 0
                    ? weightHistory[weightHistory.length - 1].emaWeight
                    : null,
                charts: {
                    weightTrend,
                    dailyCalories,
                    macroBreakdown,
                },
            };
        }
    }
};
