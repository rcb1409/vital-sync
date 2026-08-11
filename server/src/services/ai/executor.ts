import { nutritionService } from '../nutrition.service';
import { metricsService } from '../metrics.service';
import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { healthMetricsService } from '../healthMetrics.service';

/** Shape for a tool invocation from Anthropic's `tool_use` block. */
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

  // ── fetchHealthHistory ──────────────────────────────────────────────────────
  // Queries the HealthDataPoint table (synced from Google Health) for activity,
  // sleep, HRV, resting HR, VO2 max, or steps data in a given date range.
  if (call.name === 'fetchHealthHistory') {
    const { dataType, startDate, endDate } = call.args as {
      dataType: 'exercise' | 'sleep' | 'hrv' | 'resting_hr' | 'vo2_max' | 'steps' | 'all';
      startDate: string;
      endDate: string;
    };

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new Error(`Invalid date format. Expected YYYY-MM-DD, received startDate="${startDate}", endDate="${endDate}".`);
    }

    const validTypes = ['exercise', 'sleep', 'hrv', 'resting_hr', 'vo2_max', 'steps', 'all'];
    if (!validTypes.includes(dataType)) {
      throw new Error(`Invalid dataType "${dataType}". Must be one of: ${validTypes.join(', ')}.`);
    }

    console.log(`Executing Tool on Server -> fetchHealthHistory: type=${dataType} from ${startDate} to ${endDate}`);

    const where: any = {
      userId,
      recordedAt: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    };
    if (dataType !== 'all') {
      where.dataType = dataType;
    }

    const dataPoints = await prisma.healthDataPoint.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });

    // Flatten the value JSON into each data point for easier consumption
    const flattenedPoints = dataPoints.map(dp => ({
      id: dp.id,
      dataType: dp.dataType,
      recordedAt: dp.recordedAt.toISOString(),
      ...(dp.value as Record<string, unknown>),
    }));

    return { dataPoints: flattenedPoints, count: dataPoints.length };
  }

  // ── logFood ─────────────────────────────────────────────────────────────────
  if (call.name === 'logFood') {
    const args = call.args as {
      foodName: string;
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    };

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

  // ── logWeight ────────────────────────────────────────────────────────────────
  if (call.name === 'logWeight') {
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

  // ── webSearch ────────────────────────────────────────────────────────────────
  if (call.name === 'webSearch') {
    const { query } = call.args as { query: string };
    console.log(`Executing Tool on Server -> Web Search for: "${query}"`);

    if (!env.TAVILY_API_KEY) {
      throw new Error('TAVILY_API_KEY is not configured. Ask the user to configure it in their environment.');
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          search_depth: 'basic',
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

  // ── fetchNutritionHistory ──────────────────────────────────────────────────
  if (call.name === 'fetchNutritionHistory') {
    const args = call.args as { startDate: string; endDate: string };
    return executeNutritionHistoryTool(userId, args);
  }

  // ── getUserGoals ───────────────────────────────────────────────────────────
  if (call.name === 'getUserGoals') {
    return executeGetUserGoalsTool(userId);
  }

  throw new Error(`Unknown tool call: ${call.name}`);
}

// ── fetchNutritionHistory ─────────────────────────────────────────────────────
// Queries the NutritionLog table for food intake data in a given date range.
export async function executeNutritionHistoryTool(userId: string, args: { startDate: string; endDate: string }) {
  const { startDate, endDate } = args;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD, received startDate="${startDate}", endDate="${endDate}".`);
  }

  console.log(`Executing Tool on Server -> fetchNutritionHistory: from ${startDate} to ${endDate}`);

  const logs = await prisma.nutritionLog.findMany({
    where: {
      userId,
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    orderBy: { date: 'desc' },
  });

  // Group by date and calculate daily totals
  const dailyTotals: Record<string, { calories: number; proteinG: number; carbsG: number; fatG: number; meals: string[] }> = {};

  for (const log of logs) {
    const dateKey = log.date.toISOString().split('T')[0];
    if (!dailyTotals[dateKey]) {
      dailyTotals[dateKey] = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: [] };
    }
    dailyTotals[dateKey].calories += log.calories;
    dailyTotals[dateKey].proteinG += Number(log.proteinG);
    dailyTotals[dateKey].carbsG += Number(log.carbsG);
    dailyTotals[dateKey].fatG += Number(log.fatG);
    dailyTotals[dateKey].meals.push(`${log.mealType}: ${log.foodName} (${log.calories} cal)`);
  }

  return {
    dailyTotals,
    totalDays: Object.keys(dailyTotals).length,
    totalLogs: logs.length,
  };
}

// ── getUserGoals ──────────────────────────────────────────────────────────────
// Fetches the user's fitness goals from the User table.
export async function executeGetUserGoalsTool(userId: string) {
  console.log(`Executing Tool on Server -> getUserGoals for user ${userId}`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { goals: true },
  });

  if (!user || !user.goals) {
    return {
      goals: null,
      message: 'No goals have been set for this user.',
    };
  }

  const goals = user.goals as Record<string, any>;

  return {
    goals: {
      dailyCalorieTarget: goals.dailyCalorieTarget ?? null,
      dailyProteinTarget: goals.dailyProteinTarget ?? null,
      dailyStepsTarget: goals.dailyStepsTarget ?? null,
      sleepHoursTarget: goals.sleepHoursTarget ?? null,
      weeklyWorkoutTarget: goals.weeklyWorkoutTarget ?? null,
      weightGoal: goals.weightGoal ?? null,
      todayRecommendation: goals.todayRecommendation ?? null,
      adjustedCalorieTarget: goals.adjustedCalorieTarget ?? null,
    },
  };
}
