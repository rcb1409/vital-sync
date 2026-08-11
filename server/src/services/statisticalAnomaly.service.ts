// -------------------------------------------------------
// Statistical Anomaly Detection Service
// -------------------------------------------------------
// Detects health anomalies using statistical methods based on
// industry research from WHOOP, Oura, Garmin, and Apple.
//
// Methods implemented:
//   1. Z-Score Detection: Flag values > N standard deviations from personal mean
//   2. Compound Anomalies: Multi-metric patterns (e.g., HRV↓ + RHR↑ = overtraining)
//   3. CUSUM Trend Detection: Catch gradual declines over time
//
// Key differences from rule-based approach:
//   - Personal baselines instead of fixed thresholds
//   - "2.1σ below your average" instead of "20% below baseline"
//   - Adaptive to each user's natural variance
// -------------------------------------------------------

import { prisma } from '@/config/database';
import {
  statisticalBaselineService,
  type BaselineSet,
  type PersonalBaseline,
} from './statisticalBaseline.service';
import { healthMetricsService } from './healthMetrics.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StatisticalAnomalyType =
  | 'hrv_low'
  | 'hrv_high'
  | 'rhr_high'
  | 'rhr_low'
  | 'sleep_score_low'
  | 'sleep_duration_low'
  | 'steps_low'
  | 'overtraining_risk'
  | 'illness_indicator'
  | 'recovery_deficit'
  | 'hrv_declining_trend'
  | 'rhr_rising_trend';

export type AnomalySeverity = 'info' | 'warning' | 'alert';

export interface StatisticalAnomaly {
  type: StatisticalAnomalyType;
  severity: AnomalySeverity;
  message: string;
  zScore: number | null;
  data: {
    current: number;
    baseline: number;
    stdDev: number;
    percentile?: number;
    [key: string]: any;
  };
}

export interface AnomalyDetectionResult {
  anomalies: StatisticalAnomaly[];
  baselines: BaselineSet;
  metrics: {
    hrv?: { value: number; zScore: number | null };
    restingHR?: { value: number; zScore: number | null };
    sleepScore?: { value: number; zScore: number | null };
    sleepDuration?: { value: number; zScore: number | null };
    steps?: { value: number; zScore: number | null };
  };
}

// ── Thresholds ────────────────────────────────────────────────────────────────
// Based on research: 1.5σ = warning (~13% of readings), 2.5σ = alert (~1%)

const THRESHOLDS = {
  // HRV: Lower is worse (indicates stress/poor recovery)
  hrv: {
    warning: -1.5,  // 1.5 std devs below mean
    alert: -2.5,    // 2.5 std devs below mean
    direction: 'lower_is_worse' as const,
  },
  // Resting HR: Higher is worse (indicates stress/illness)
  restingHR: {
    warning: 1.5,   // 1.5 std devs above mean
    alert: 2.5,     // 2.5 std devs above mean
    direction: 'higher_is_worse' as const,
  },
  // Sleep Score: Lower is worse
  sleepScore: {
    warning: -1.5,
    alert: -2.5,
    direction: 'lower_is_worse' as const,
  },
  // Sleep Duration: Lower is worse
  sleepDuration: {
    warning: -1.5,
    alert: -2.5,
    direction: 'lower_is_worse' as const,
  },
  // Steps: Lower is worse (less sensitive - use higher thresholds)
  steps: {
    warning: -2.0,
    alert: -3.0,
    direction: 'lower_is_worse' as const,
  },
};

// ── Z-Score Anomaly Detection ─────────────────────────────────────────────────

/**
 * Converts a Z-score to an approximate percentile.
 * Useful for user-friendly messages like "bottom 5% of your readings".
 */
function zScoreToPercentile(z: number): number {
  // Approximation using the error function
  // For z in [-3, 3], this is accurate to ~0.1%
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);

  const cdf = 0.5 * (1.0 + sign * y);
  return Math.round(cdf * 100);
}

/**
 * Detects single-metric anomalies using Z-scores.
 */
function detectZScoreAnomalies(
  metricName: string,
  value: number,
  baseline: PersonalBaseline | null,
  thresholds: { warning: number; alert: number; direction: 'lower_is_worse' | 'higher_is_worse' }
): StatisticalAnomaly | null {
  if (!baseline || baseline.stdDev === 0) return null;

  const zScore = statisticalBaselineService.calculateZScore(
    value,
    baseline.ewmaMean,
    baseline.stdDev
  );

  // Check if anomaly based on direction
  let isWarning = false;
  let isAlert = false;

  if (thresholds.direction === 'lower_is_worse') {
    isWarning = zScore < thresholds.warning;
    isAlert = zScore < thresholds.alert;
  } else {
    isWarning = zScore > thresholds.warning;
    isAlert = zScore > thresholds.alert;
  }

  if (!isWarning && !isAlert) return null;

  const severity: AnomalySeverity = isAlert ? 'alert' : 'warning';
  const percentile = zScoreToPercentile(zScore);
  const absZ = Math.abs(zScore).toFixed(1);

  // Build user-friendly message
  let message: string;
  const direction = zScore < 0 ? 'below' : 'above';

  switch (metricName) {
    case 'hrv':
      message = `Your HRV (${Math.round(value)}ms) is ${absZ} standard deviations ${direction} your personal average of ${Math.round(baseline.ewmaMean)}ms. This is in the bottom ${percentile}% of your readings.`;
      break;
    case 'restingHR':
      message = `Your resting heart rate (${Math.round(value)} bpm) is ${absZ} standard deviations ${direction} your personal average of ${Math.round(baseline.ewmaMean)} bpm. This suggests your body may be under stress.`;
      break;
    case 'sleepScore':
      message = `Your sleep score (${Math.round(value)}) is ${absZ} standard deviations ${direction} your personal average of ${Math.round(baseline.ewmaMean)}. Consider prioritizing rest tonight.`;
      break;
    case 'sleepDuration':
      const hours = (value / 60).toFixed(1);
      const avgHours = (baseline.ewmaMean / 60).toFixed(1);
      message = `Your sleep duration (${hours}h) is ${absZ} standard deviations ${direction} your personal average of ${avgHours}h.`;
      break;
    case 'steps':
      message = `Your step count (${Math.round(value)}) is ${absZ} standard deviations ${direction} your personal average of ${Math.round(baseline.ewmaMean)}.`;
      break;
    default:
      message = `${metricName} is ${absZ} standard deviations ${direction} your personal average.`;
  }

  return {
    type: `${metricName}_${zScore < 0 ? 'low' : 'high'}` as StatisticalAnomalyType,
    severity,
    message,
    zScore,
    data: {
      current: value,
      baseline: baseline.ewmaMean,
      stdDev: baseline.stdDev,
      percentile,
    },
  };
}

// ── Compound Anomaly Detection ────────────────────────────────────────────────

interface MetricZScores {
  hrv?: number | null;
  restingHR?: number | null;
  sleepScore?: number | null;
  sleepDuration?: number | null;
  steps?: number | null;
}

/**
 * Detects compound anomalies from multiple metrics.
 * Based on Garmin/Firstbeat's approach of combining signals.
 */
function detectCompoundAnomalies(
  zScores: MetricZScores,
  recentWorkoutCount: number
): StatisticalAnomaly[] {
  const anomalies: StatisticalAnomaly[] = [];

  // Overtraining Risk: HRV↓ + RHR↑ + high training load
  if (
    zScores.hrv != null && zScores.hrv < -1.0 &&
    zScores.restingHR != null && zScores.restingHR > 1.0 &&
    recentWorkoutCount >= 5
  ) {
    anomalies.push({
      type: 'overtraining_risk',
      severity: 'alert',
      message: `Overtraining risk detected: Your HRV is low (${Math.abs(zScores.hrv).toFixed(1)}σ below average), resting HR is elevated (${zScores.restingHR.toFixed(1)}σ above average), and you've had ${recentWorkoutCount} workouts in the past 7 days. Consider a rest day.`,
      zScore: zScores.hrv,
      data: {
        current: 0,
        baseline: 0,
        stdDev: 0,
        hrvZScore: zScores.hrv,
        rhrZScore: zScores.restingHR,
        workoutCount: recentWorkoutCount,
      },
    });
  }

  // Illness Indicator: RHR↑↑ + HRV↓↓
  if (
    zScores.restingHR != null && zScores.restingHR > 2.0 &&
    zScores.hrv != null && zScores.hrv < -1.5
  ) {
    anomalies.push({
      type: 'illness_indicator',
      severity: 'alert',
      message: `Your resting heart rate is significantly elevated (${zScores.restingHR.toFixed(1)}σ above average) while HRV is suppressed (${Math.abs(zScores.hrv).toFixed(1)}σ below average). This pattern can indicate your immune system is fighting something. Monitor for other symptoms.`,
      zScore: zScores.restingHR,
      data: {
        current: 0,
        baseline: 0,
        stdDev: 0,
        hrvZScore: zScores.hrv,
        rhrZScore: zScores.restingHR,
      },
    });
  }

  // Recovery Deficit: Poor sleep + declining HRV
  if (
    zScores.sleepScore != null && zScores.sleepScore < -1.0 &&
    zScores.hrv != null && zScores.hrv < -1.0
  ) {
    anomalies.push({
      type: 'recovery_deficit',
      severity: 'warning',
      message: `Recovery deficit: Both your sleep quality (${Math.abs(zScores.sleepScore).toFixed(1)}σ below average) and HRV (${Math.abs(zScores.hrv).toFixed(1)}σ below average) are low. Prioritize rest and sleep hygiene tonight.`,
      zScore: zScores.sleepScore,
      data: {
        current: 0,
        baseline: 0,
        stdDev: 0,
        sleepZScore: zScores.sleepScore,
        hrvZScore: zScores.hrv,
      },
    });
  }

  return anomalies;
}

// ── CUSUM Trend Detection ─────────────────────────────────────────────────────

/**
 * Calculates CUSUM (Cumulative Sum) for trend detection.
 * 
 * CUSUM detects gradual shifts that don't trigger single-day anomalies.
 * Example: HRV dropping 2ms/day for 2 weeks won't trigger Z-score alert,
 * but CUSUM catches the sustained drift.
 * 
 * @param values Array of values (oldest to newest)
 * @param target Target value (usually the baseline mean)
 * @param allowance Slack parameter to ignore normal noise (usually 0.5 * stdDev)
 * @returns CUSUM value (positive = above target, negative = below target)
 */
function calculateCUSUM(
  values: number[],
  target: number,
  allowance: number
): { upper: number; lower: number } {
  let upperCusum = 0;
  let lowerCusum = 0;

  for (const value of values) {
    // Upper CUSUM: detects upward shifts
    upperCusum = Math.max(0, upperCusum + (value - target - allowance));
    // Lower CUSUM: detects downward shifts
    lowerCusum = Math.min(0, lowerCusum + (value - target + allowance));
  }

  return { upper: upperCusum, lower: lowerCusum };
}

/**
 * Detects trends using CUSUM.
 * Alert threshold is typically 4-5 * stdDev.
 */
async function detectTrendAnomalies(
  userId: string,
  baselines: BaselineSet
): Promise<StatisticalAnomaly[]> {
  const anomalies: StatisticalAnomaly[] = [];
  const windowDays = 14;
  const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Fetch recent data for trend analysis
  const dataPoints = await prisma.healthDataPoint.findMany({
    where: {
      userId,
      recordedAt: { gte: startDate },
      dataType: { in: ['hrv', 'resting_hr'] },
    },
    orderBy: { recordedAt: 'asc' },
  });

  // Group by type
  const hrvValues: number[] = [];
  const rhrValues: number[] = [];

  for (const dp of dataPoints) {
    const value = dp.value as Record<string, any>;
    if (dp.dataType === 'hrv' && value?.hrvRmssd) {
      hrvValues.push(value.hrvRmssd);
    } else if (dp.dataType === 'resting_hr' && value?.restingHR) {
      rhrValues.push(value.restingHR);
    }
  }

  // Check HRV declining trend
  if (hrvValues.length >= 7 && baselines.hrv) {
    const allowance = 0.5 * baselines.hrv.stdDev;
    const threshold = 4 * baselines.hrv.stdDev;
    const cusum = calculateCUSUM(hrvValues, baselines.hrv.ewmaMean, allowance);

    if (cusum.lower < -threshold) {
      anomalies.push({
        type: 'hrv_declining_trend',
        severity: 'warning',
        message: `Your HRV has been trending downward over the past ${windowDays} days. This sustained decline suggests accumulated fatigue or stress.`,
        zScore: null,
        data: {
          current: hrvValues[hrvValues.length - 1],
          baseline: baselines.hrv.ewmaMean,
          stdDev: baselines.hrv.stdDev,
          cusumValue: cusum.lower,
          threshold: -threshold,
        },
      });
    }
  }

  // Check RHR rising trend
  if (rhrValues.length >= 7 && baselines.restingHR) {
    const allowance = 0.5 * baselines.restingHR.stdDev;
    const threshold = 4 * baselines.restingHR.stdDev;
    const cusum = calculateCUSUM(rhrValues, baselines.restingHR.ewmaMean, allowance);

    if (cusum.upper > threshold) {
      anomalies.push({
        type: 'rhr_rising_trend',
        severity: 'warning',
        message: `Your resting heart rate has been trending upward over the past ${windowDays} days. This sustained increase may indicate chronic stress or overtraining.`,
        zScore: null,
        data: {
          current: rhrValues[rhrValues.length - 1],
          baseline: baselines.restingHR.ewmaMean,
          stdDev: baselines.restingHR.stdDev,
          cusumValue: cusum.upper,
          threshold,
        },
      });
    }
  }

  return anomalies;
}

// ── Main Detection Function ───────────────────────────────────────────────────

/**
 * Main entry point: Detects all anomalies for a user's recent health data.
 * 
 * This function:
 *   1. Calculates personal baselines (EWMA + rolling std dev)
 *   2. Fetches most recent values for each metric
 *   3. Calculates Z-scores and detects single-metric anomalies
 *   4. Detects compound anomalies (multi-metric patterns)
 *   5. Detects trend anomalies (CUSUM)
 */
async function detectAnomalies(userId: string): Promise<AnomalyDetectionResult> {
  // Step 1: Calculate personal baselines
  const baselines = await statisticalBaselineService.calculateUserBaselines(userId);

  // Step 2: Fetch most recent values
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const [latestHRV, latestRHR, latestSleep, latestSteps] = await Promise.all([
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'hrv', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'resting_hr', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'sleep', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'steps', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  // Extract values
  const hrvValue = (latestHRV?.value as any)?.hrvRmssd ?? null;
  const rhrValue = (latestRHR?.value as any)?.restingHR ?? null;
  const sleepValue = latestSleep?.value as any;
  const sleepScoreValue = sleepValue ? healthMetricsService.computeSleepScoreSafe(sleepValue) : null;
  const sleepDurationValue = sleepValue?.durationMinutes ?? null;
  const stepsValue = (latestSteps?.value as any)?.totalSteps ?? null;

  // Step 3: Calculate Z-scores
  const metrics: AnomalyDetectionResult['metrics'] = {};
  const zScores: MetricZScores = {};

  if (hrvValue != null) {
    const z = statisticalBaselineService.calculateMetricZScore(hrvValue, baselines.hrv);
    metrics.hrv = { value: hrvValue, zScore: z };
    zScores.hrv = z;
  }

  if (rhrValue != null) {
    const z = statisticalBaselineService.calculateMetricZScore(rhrValue, baselines.restingHR);
    metrics.restingHR = { value: rhrValue, zScore: z };
    zScores.restingHR = z;
  }

  if (sleepScoreValue != null) {
    const z = statisticalBaselineService.calculateMetricZScore(sleepScoreValue, baselines.sleepScore);
    metrics.sleepScore = { value: sleepScoreValue, zScore: z };
    zScores.sleepScore = z;
  }

  if (sleepDurationValue != null) {
    const z = statisticalBaselineService.calculateMetricZScore(sleepDurationValue, baselines.sleepDuration);
    metrics.sleepDuration = { value: sleepDurationValue, zScore: z };
    zScores.sleepDuration = z;
  }

  if (stepsValue != null) {
    const z = statisticalBaselineService.calculateMetricZScore(stepsValue, baselines.steps);
    metrics.steps = { value: stepsValue, zScore: z };
    zScores.steps = z;
  }

  // Step 4: Detect single-metric anomalies
  const anomalies: StatisticalAnomaly[] = [];

  if (hrvValue != null) {
    const anomaly = detectZScoreAnomalies('hrv', hrvValue, baselines.hrv, THRESHOLDS.hrv);
    if (anomaly) anomalies.push(anomaly);
  }

  if (rhrValue != null) {
    const anomaly = detectZScoreAnomalies('restingHR', rhrValue, baselines.restingHR, THRESHOLDS.restingHR);
    if (anomaly) anomalies.push(anomaly);
  }

  if (sleepScoreValue != null) {
    const anomaly = detectZScoreAnomalies('sleepScore', sleepScoreValue, baselines.sleepScore, THRESHOLDS.sleepScore);
    if (anomaly) anomalies.push(anomaly);
  }

  if (sleepDurationValue != null) {
    const anomaly = detectZScoreAnomalies('sleepDuration', sleepDurationValue, baselines.sleepDuration, THRESHOLDS.sleepDuration);
    if (anomaly) anomalies.push(anomaly);
  }

  if (stepsValue != null) {
    const anomaly = detectZScoreAnomalies('steps', stepsValue, baselines.steps, THRESHOLDS.steps);
    if (anomaly) anomalies.push(anomaly);
  }

  // Step 5: Count recent workouts for compound detection
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentWorkouts = await prisma.healthDataPoint.count({
    where: {
      userId,
      dataType: 'exercise',
      recordedAt: { gte: sevenDaysAgo },
    },
  });

  // Step 6: Detect compound anomalies
  const compoundAnomalies = detectCompoundAnomalies(zScores, recentWorkouts);
  anomalies.push(...compoundAnomalies);

  // Step 7: Detect trend anomalies
  const trendAnomalies = await detectTrendAnomalies(userId, baselines);
  anomalies.push(...trendAnomalies);

  // Sort by severity (alert > warning > info)
  const severityOrder = { alert: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    anomalies,
    baselines,
    metrics,
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const statisticalAnomalyService = {
  detectAnomalies,
  detectZScoreAnomalies,
  detectCompoundAnomalies,
  detectTrendAnomalies,
  calculateCUSUM,
  zScoreToPercentile,
  THRESHOLDS,
};
