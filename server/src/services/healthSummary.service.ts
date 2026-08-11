// -------------------------------------------------------
// Health Summary Service
// -------------------------------------------------------
// Computes and persists rolling health summaries (weekly/monthly).
// Called after each sync to update pre-computed metrics that
// the AI coach uses for context.
//
// Two summary windows per user:
//   - "weekly" (7-day rolling)
//   - "monthly" (30-day rolling)
// -------------------------------------------------------

import { prisma } from '../config/database';
import {
  healthMetricsService,
  type SleepData,
  type ExerciseData,
  type WeeklyTrainingLoad,
} from './healthMetrics.service';
import { computeTrend } from './healthAnalysis.service';

/**
 * Summary window type.
 */
export type SummaryWindow = 'weekly' | 'monthly';

/**
 * Full health summary data structure.
 */
export interface HealthSummaryData {
  // Sleep
  sleepAvgMinutes: number;
  sleepAvgDeep: number;
  sleepAvgRem: number;
  sleepDataCount: number;
  sleepTrend: string;
  sleepRecentValues: number[];
  avgSleepScore: number;

  // Exercise
  workoutCount: number;
  workoutAvgDuration: number;
  workoutAvgCalories: number;
  restDayStreak: number;
  trainingDayStreak: number;
  workoutTypes: Record<string, number>;
  weeklyTrainingLoad: WeeklyTrainingLoad;

  // Recovery
  avgHRV: number;
  avgRestingHR: number;
  latestRecoveryScore: number;
  recoveryTrend: string;
  hrvRecentValues: number[];
  rhrRecentValues: number[];

  // Activity
  avgDailySteps: number;
  latestVO2Max: number;
  vo2MaxTrend: string;
  stepsRecentValues: number[];
}

/**
 * Updates the health summary for a user for a specific window.
 * Fetches all relevant data points, computes metrics, and upserts the summary.
 */
export async function updateHealthSummary(
  userId: string,
  window: SummaryWindow
): Promise<void> {
  const days = window === 'weekly' ? 7 : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fetch all data points for the window in parallel
  const [sleepData, exerciseData, hrvData, rhrData, stepsData, vo2Data] = await Promise.all([
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'sleep', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'exercise', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'hrv', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'resting_hr', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'steps', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findMany({
      where: { userId, dataType: 'vo2_max', recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  // ── Compute Sleep Metrics ───────────────────────────────────────────────────
  const sleepValues = sleepData.map(s => s.value as unknown as SleepData);
  const sleepDurations = sleepValues.map(s => s.durationMinutes ?? 0);
  const sleepDeepMins = sleepValues.map(s => s.stages?.deep ?? 0);
  const sleepRemMins = sleepValues.map(s => s.stages?.rem ?? 0);
  const sleepScores = sleepValues.map(s => healthMetricsService.computeSleepScoreSafe(s));

  const sleepAvgMinutes = healthMetricsService.average(sleepDurations);
  const sleepAvgDeep = healthMetricsService.average(sleepDeepMins);
  const sleepAvgRem = healthMetricsService.average(sleepRemMins);
  const avgSleepScore = healthMetricsService.average(sleepScores);
  const sleepTrend = computeTrend(sleepScores);

  // ── Compute Exercise Metrics ────────────────────────────────────────────────
  const exerciseValues = exerciseData.map(e => e.value as unknown as ExerciseData);
  const workoutDurations = exerciseValues.map(e => e.durationMinutes ?? 0);
  const workoutCalories = exerciseValues.map(e => e.calories ?? 0);

  const workoutCount = exerciseData.length;
  const workoutAvgDuration = healthMetricsService.average(workoutDurations);
  const workoutAvgCalories = healthMetricsService.average(workoutCalories);

  // Count workout types
  const workoutTypes: Record<string, number> = {};
  for (const e of exerciseValues) {
    const type = e.activityType ?? 'other';
    workoutTypes[type] = (workoutTypes[type] ?? 0) + 1;
  }

  // Compute training load
  const weeklyTrainingLoad = healthMetricsService.computeWeeklyTrainingLoad(exerciseValues);

  // Compute streaks
  const { restDayStreak, trainingDayStreak } = computeStreaks(exerciseData.map(e => e.recordedAt));

  // ── Compute Recovery Metrics ────────────────────────────────────────────────
  const hrvValues = hrvData.map(h => (h.value as any)?.hrvRmssd as number).filter(v => v != null);
  const rhrValues = rhrData.map(r => (r.value as any)?.restingHR as number).filter(v => v != null);

  const avgHRV = healthMetricsService.average(hrvValues);
  const avgRestingHR = healthMetricsService.average(rhrValues);
  const recoveryTrend = computeTrend(hrvValues);

  // Compute latest recovery score
  const latestHRV = hrvValues[0] ?? null;
  const latestRHR = rhrValues[0] ?? null;
  const latestSleepScore = sleepScores[0] ?? 50;
  const latestRecoveryScore = healthMetricsService.computeRecoveryScoreSafe({
    hrvRmssd: latestHRV,
    restingHR: latestRHR,
    sleepScore: latestSleepScore,
    hrvBaseline: avgHRV,
    rhrBaseline: avgRestingHR,
  });

  // ── Compute Activity Metrics ────────────────────────────────────────────────
  const stepsValues = stepsData.map(s => (s.value as any)?.totalSteps as number).filter(v => v != null);
  const vo2Values = vo2Data.map(v => (v.value as any)?.vo2MaxMlPerMinPerKg as number).filter(v => v != null);

  const avgDailySteps = Math.round(healthMetricsService.average(stepsValues));
  const latestVO2Max = vo2Values[0] ?? 0;
  const vo2MaxTrend = computeTrend(vo2Values);

  // ── Upsert Summary ──────────────────────────────────────────────────────────
  await prisma.healthSummary.upsert({
    where: { userId_window: { userId, window } },
    update: {
      // Sleep
      sleepAvgMinutes,
      sleepAvgDeep,
      sleepAvgRem,
      sleepDataCount: sleepData.length,
      sleepTrend,
      sleepRecentValues: sleepDurations.slice(0, 10),
      avgSleepScore,

      // Exercise
      workoutCount,
      workoutAvgDuration,
      workoutAvgCalories,
      restDayStreak,
      trainingDayStreak,
      workoutTypes,
      weeklyTrainingLoad: weeklyTrainingLoad as any,

      // Recovery
      avgHRV,
      avgRestingHR,
      latestRecoveryScore,
      recoveryTrend,
      hrvRecentValues: hrvValues.slice(0, 10),
      rhrRecentValues: rhrValues.slice(0, 10),

      // Activity
      avgDailySteps,
      latestVO2Max,
      vo2MaxTrend,
      stepsRecentValues: stepsValues.slice(0, 10),
    },
    create: {
      userId,
      window,
      // Sleep
      sleepAvgMinutes,
      sleepAvgDeep,
      sleepAvgRem,
      sleepDataCount: sleepData.length,
      sleepTrend,
      sleepRecentValues: sleepDurations.slice(0, 10),
      avgSleepScore,

      // Exercise
      workoutCount,
      workoutAvgDuration,
      workoutAvgCalories,
      restDayStreak,
      trainingDayStreak,
      workoutTypes,
      weeklyTrainingLoad: weeklyTrainingLoad as any,

      // Recovery
      avgHRV,
      avgRestingHR,
      latestRecoveryScore,
      recoveryTrend,
      hrvRecentValues: hrvValues.slice(0, 10),
      rhrRecentValues: rhrValues.slice(0, 10),

      // Activity
      avgDailySteps,
      latestVO2Max,
      vo2MaxTrend,
      stepsRecentValues: stepsValues.slice(0, 10),
    },
  });
}

/**
 * Updates both weekly and monthly summaries for a user.
 * Called after each sync operation.
 */
export async function updateAllSummaries(userId: string): Promise<void> {
  await Promise.all([
    updateHealthSummary(userId, 'weekly'),
    updateHealthSummary(userId, 'monthly'),
  ]);
}

/**
 * Retrieves the health summary for a user and window.
 * Returns null if no summary exists yet.
 */
export async function getHealthSummary(
  userId: string,
  window: SummaryWindow
): Promise<HealthSummaryData | null> {
  const summary = await prisma.healthSummary.findUnique({
    where: { userId_window: { userId, window } },
  });

  if (!summary) return null;

  return {
    // Sleep
    sleepAvgMinutes: summary.sleepAvgMinutes,
    sleepAvgDeep: summary.sleepAvgDeep,
    sleepAvgRem: summary.sleepAvgRem,
    sleepDataCount: summary.sleepDataCount,
    sleepTrend: summary.sleepTrend,
    sleepRecentValues: summary.sleepRecentValues as number[],
    avgSleepScore: summary.avgSleepScore,

    // Exercise
    workoutCount: summary.workoutCount,
    workoutAvgDuration: summary.workoutAvgDuration,
    workoutAvgCalories: summary.workoutAvgCalories,
    restDayStreak: summary.restDayStreak,
    trainingDayStreak: summary.trainingDayStreak,
    workoutTypes: summary.workoutTypes as Record<string, number>,
    weeklyTrainingLoad: summary.weeklyTrainingLoad as unknown as WeeklyTrainingLoad,

    // Recovery
    avgHRV: summary.avgHRV,
    avgRestingHR: summary.avgRestingHR,
    latestRecoveryScore: summary.latestRecoveryScore,
    recoveryTrend: summary.recoveryTrend,
    hrvRecentValues: summary.hrvRecentValues as number[],
    rhrRecentValues: summary.rhrRecentValues as number[],

    // Activity
    avgDailySteps: summary.avgDailySteps,
    latestVO2Max: summary.latestVO2Max,
    vo2MaxTrend: summary.vo2MaxTrend,
    stepsRecentValues: summary.stepsRecentValues as number[],
  };
}

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Computes rest day and training day streaks from workout dates.
 */
function computeStreaks(workoutDates: Date[]): {
  restDayStreak: number;
  trainingDayStreak: number;
} {
  if (workoutDates.length === 0) {
    return { restDayStreak: 0, trainingDayStreak: 0 };
  }

  // Get unique workout days (YYYY-MM-DD)
  const workoutDays = new Set(
    workoutDates.map(d => d.toISOString().split('T')[0])
  );

  const today = new Date().toISOString().split('T')[0];
  let restDayStreak = 0;
  let trainingDayStreak = 0;

  // Count consecutive rest days from today backwards
  let checkDate = new Date();
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (workoutDays.has(dateStr)) {
      break;
    }
    restDayStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
    if (restDayStreak > 30) break; // Cap at 30 days
  }

  // Count consecutive training days from today backwards
  checkDate = new Date();
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (!workoutDays.has(dateStr)) {
      break;
    }
    trainingDayStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
    if (trainingDayStreak > 30) break; // Cap at 30 days
  }

  return { restDayStreak, trainingDayStreak };
}

// ── Export Service ────────────────────────────────────────────────────────────

export const healthSummaryService = {
  updateHealthSummary,
  updateAllSummaries,
  getHealthSummary,
};
