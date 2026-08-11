// -------------------------------------------------------
// Health Metrics Service
// -------------------------------------------------------
// Computes derived health metrics from raw Google Health data:
//   - Sleep Score (0-100)
//   - Recovery Score (0-100)
//   - Training Load (weekly summary)
//
// These computed metrics power the AI coach's context and
// the HealthSummary table for trend analysis.
// -------------------------------------------------------

/**
 * Sleep data shape from normalized Google Health sleep data points.
 */
export interface SleepData {
  durationMinutes: number;
  stages: {
    deep: number;
    rem: number;
    light: number;
    awake: number;
  };
}

/**
 * Exercise data shape from normalized Google Health exercise data points.
 */
export interface ExerciseData {
  activityType: 'run' | 'walk' | 'strength';
  durationMinutes: number | null;
  calories: number | null;
  heartRateZones?: {
    lightMins: number;
    moderateMins: number;
    vigorousMins: number;
    peakMins: number;
  } | null;
  startTime: string | null;
}

/**
 * Parameters for computing recovery score.
 */
export interface RecoveryScoreParams {
  hrvRmssd: number | null;
  restingHR: number | null;
  sleepScore: number;
  hrvBaseline: number;
  rhrBaseline: number;
}

/**
 * Weekly training load summary.
 */
export interface WeeklyTrainingLoad {
  totalMinutes: number;
  totalCalories: number;
  intensityScore: number;
  sessionCount: number;
  varietyScore: number;
  workoutTypes: Record<string, number>;
}

// ── Sleep Score ───────────────────────────────────────────────────────────────

/**
 * Computes a sleep quality score from 0-100 based on:
 *   - Duration (40 points max) - 8 hours = full points
 *   - Deep sleep (25 points max) - 90 minutes = full points
 *   - REM sleep (20 points max) - 120 minutes = full points
 *   - Sleep efficiency (15 points max) - less awake time = more points
 *
 * Based on sleep science research:
 *   - Adults need 7-9 hours of sleep
 *   - Deep sleep should be 13-23% of total (60-110 min for 8hr)
 *   - REM should be 20-25% of total (96-120 min for 8hr)
 */
export function computeSleepScore(sleep: SleepData): number {
  const TARGET_DURATION = 480;  // 8 hours in minutes
  const TARGET_DEEP = 90;       // 90 minutes of deep sleep
  const TARGET_REM = 120;       // 120 minutes of REM sleep

  // Duration component (40 points)
  // Linear scale up to target, capped at 40
  const durationScore = Math.min((sleep.durationMinutes / TARGET_DURATION) * 40, 40);

  // Deep sleep component (25 points)
  const deepScore = Math.min((sleep.stages.deep / TARGET_DEEP) * 25, 25);

  // REM sleep component (20 points)
  const remScore = Math.min((sleep.stages.rem / TARGET_REM) * 20, 20);

  // Sleep efficiency component (15 points)
  // Efficiency = time asleep / time in bed
  // Penalize for time spent awake
  const totalSleepTime = sleep.stages.deep + sleep.stages.rem + sleep.stages.light;
  const efficiency = sleep.durationMinutes > 0
    ? totalSleepTime / sleep.durationMinutes
    : 0;
  const efficiencyScore = Math.max(0, efficiency * 15);

  const totalScore = durationScore + deepScore + remScore + efficiencyScore;
  return Math.round(Math.min(Math.max(totalScore, 0), 100));
}

/**
 * Computes sleep score with fallback for missing stage data.
 * If stages are not available, uses duration-only scoring.
 */
export function computeSleepScoreSafe(sleep: Partial<SleepData>): number {
  const durationMinutes = sleep.durationMinutes ?? 0;
  const stages = sleep.stages ?? { deep: 0, rem: 0, light: 0, awake: 0 };

  // If no stage data, use simplified duration-based score
  const hasStageData = stages.deep > 0 || stages.rem > 0 || stages.light > 0;
  if (!hasStageData) {
    // Simple duration score: 8 hours = 75 points (leaving room for stage bonus)
    const durationScore = Math.min((durationMinutes / 480) * 75, 75);
    return Math.round(durationScore);
  }

  return computeSleepScore({ durationMinutes, stages });
}

// ── Recovery Score ────────────────────────────────────────────────────────────

/**
 * Computes a recovery/readiness score from 0-100 based on:
 *   - HRV (40 points) - higher than baseline = better recovery
 *   - Resting HR (25 points) - lower than baseline = better recovery
 *   - Sleep score (35 points) - better sleep = better recovery
 *
 * The score compares current values to the user's personal baseline
 * (typically a 7-day rolling average) to account for individual variation.
 *
 * Interpretation:
 *   - 80-100: Excellent recovery, ready for intense training
 *   - 60-79: Good recovery, normal training OK
 *   - 40-59: Moderate recovery, consider lighter training
 *   - 0-39: Poor recovery, prioritize rest
 */
export function computeRecoveryScore(params: RecoveryScoreParams): number {
  let score = 0;

  // HRV component (40 points max, can exceed baseline for bonus)
  // Higher HRV = better parasympathetic activity = better recovery
  if (params.hrvRmssd != null && params.hrvBaseline > 0) {
    const hrvRatio = params.hrvRmssd / params.hrvBaseline;
    // Allow up to 50 points if HRV is significantly above baseline
    score += Math.min(hrvRatio * 40, 50);
  } else {
    // Neutral score if no HRV data available
    score += 20;
  }

  // Resting HR component (25 points max)
  // Lower RHR = better cardiovascular efficiency = better recovery
  if (params.restingHR != null && params.rhrBaseline > 0) {
    // Inverse ratio: baseline/current (lower current = higher score)
    const rhrRatio = params.rhrBaseline / params.restingHR;
    // Allow up to 30 points if RHR is significantly below baseline
    score += Math.min(rhrRatio * 25, 30);
  } else {
    // Neutral score if no RHR data available
    score += 12.5;
  }

  // Sleep component (35 points)
  score += (params.sleepScore / 100) * 35;

  return Math.round(Math.min(Math.max(score, 0), 100));
}

/**
 * Computes recovery score with safe defaults for missing data.
 */
export function computeRecoveryScoreSafe(params: Partial<RecoveryScoreParams>): number {
  return computeRecoveryScore({
    hrvRmssd: params.hrvRmssd ?? null,
    restingHR: params.restingHR ?? null,
    sleepScore: params.sleepScore ?? 50, // Neutral default
    hrvBaseline: params.hrvBaseline ?? 0,
    rhrBaseline: params.rhrBaseline ?? 0,
  });
}

// ── Training Load ─────────────────────────────────────────────────────────────

/**
 * Computes weekly training load metrics from exercise data points.
 *
 * Returns:
 *   - totalMinutes: Sum of all workout durations
 *   - totalCalories: Sum of all calories burned
 *   - intensityScore: Weighted average based on HR zones (0-100)
 *   - sessionCount: Number of workouts
 *   - varietyScore: Diversity of workout types (0-100)
 *   - workoutTypes: Count by activity type
 */
export function computeWeeklyTrainingLoad(workouts: ExerciseData[]): WeeklyTrainingLoad {
  if (workouts.length === 0) {
    return {
      totalMinutes: 0,
      totalCalories: 0,
      intensityScore: 0,
      sessionCount: 0,
      varietyScore: 0,
      workoutTypes: {},
    };
  }

  // Sum totals
  const totalMinutes = workouts.reduce((sum, w) => sum + (w.durationMinutes ?? 0), 0);
  const totalCalories = workouts.reduce((sum, w) => sum + (w.calories ?? 0), 0);

  // Count workout types
  const workoutTypes: Record<string, number> = {};
  for (const w of workouts) {
    workoutTypes[w.activityType] = (workoutTypes[w.activityType] ?? 0) + 1;
  }

  // Intensity score based on HR zones (if available)
  // Weights: light=1, moderate=2, vigorous=3, peak=4
  let intensitySum = 0;
  let intensityCount = 0;
  for (const w of workouts) {
    if (w.heartRateZones && w.durationMinutes) {
      const zones = w.heartRateZones;
      const totalZoneMins = zones.lightMins + zones.moderateMins + zones.vigorousMins + zones.peakMins;
      if (totalZoneMins > 0) {
        const weightedIntensity = (
          zones.lightMins * 1 +
          zones.moderateMins * 2 +
          zones.vigorousMins * 3 +
          zones.peakMins * 4
        ) / totalZoneMins;
        // Normalize to 0-100 scale (max weighted intensity is 4)
        intensitySum += (weightedIntensity / 4) * 100;
        intensityCount++;
      }
    } else {
      // Default moderate intensity if no HR data
      intensitySum += 50;
      intensityCount++;
    }
  }
  const intensityScore = intensityCount > 0
    ? Math.round(intensitySum / intensityCount)
    : 50;

  // Variety score: more unique activity types = higher score
  // 1 type = 25, 2 types = 50, 3 types = 75, 4+ types = 100
  const uniqueTypes = Object.keys(workoutTypes).length;
  const varietyScore = Math.min(uniqueTypes * 25, 100);

  return {
    totalMinutes,
    totalCalories,
    intensityScore,
    sessionCount: workouts.length,
    varietyScore,
    workoutTypes,
  };
}

// ── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Computes the average of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Computes the standard deviation of an array of numbers.
 * Returns 0 for arrays with fewer than 2 elements.
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(average(squaredDiffs));
}

/**
 * Filters out null/undefined values and returns only valid numbers.
 */
export function filterValidNumbers(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => v != null && !isNaN(v));
}

// ── Export Service ────────────────────────────────────────────────────────────

export const healthMetricsService = {
  // Sleep
  computeSleepScore,
  computeSleepScoreSafe,
  // Recovery
  computeRecoveryScore,
  computeRecoveryScoreSafe,
  // Training
  computeWeeklyTrainingLoad,
  // Utilities
  average,
  standardDeviation,
  filterValidNumbers,
};
