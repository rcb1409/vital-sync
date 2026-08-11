// -------------------------------------------------------
// Health Analysis Service
// -------------------------------------------------------
// Provides trend detection and anomaly detection for health data.
// Used by the AI coach to surface proactive insights.
//
// Features:
//   - Trend detection (IMPROVING / DECLINING / STABLE)
//   - Anomaly detection (sleep drops, HRV drops, RHR spikes, overtraining)
//
// UPGRADED (v2): Now includes statistical anomaly detection using:
//   - Z-scores with personal baselines (EWMA)
//   - Compound anomalies (multi-metric patterns)
//   - CUSUM trend detection
// -------------------------------------------------------

import { healthMetricsService, type SleepData } from './healthMetrics.service';
import {
  statisticalAnomalyService,
  type StatisticalAnomaly,
  type AnomalyDetectionResult,
} from './statisticalAnomaly.service';
import { statisticalBaselineService, type BaselineSet } from './statisticalBaseline.service';

/**
 * Trend direction enum.
 */
export type TrendDirection = 'IMPROVING' | 'DECLINING' | 'STABLE';

/**
 * Health anomaly types.
 */
export type AnomalyType =
  | 'sleep_drop'
  | 'hrv_drop'
  | 'rhr_spike'
  | 'overtraining_risk'
  | 'inactivity'
  | 'sleep_debt';

/**
 * Anomaly severity levels.
 */
export type AnomalySeverity = 'info' | 'warning' | 'alert';

/**
 * Health anomaly structure.
 */
export interface HealthAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  data: Record<string, any>;
}

/**
 * Baselines for anomaly detection.
 */
export interface HealthBaselines {
  sleepScore: number;
  hrv: number;
  rhr: number;
  dailySteps: number;
}

/**
 * Recent health data for anomaly detection.
 */
export interface RecentHealthData {
  sleep: SleepData[];
  hrv: { hrvRmssd: number; date: string }[];
  rhr: { restingHR: number; date: string }[];
  exercise: { startTime: string; durationMinutes: number }[];
  steps: { date: string; totalSteps: number }[];
}

// ── Trend Detection ───────────────────────────────────────────────────────────

/**
 * Computes the trend direction from a series of values.
 * Compares the average of the first half to the second half.
 *
 * @param values - Array of numeric values (oldest to newest or newest to oldest)
 * @param threshold - Percentage change threshold for trend detection (default: 5%)
 * @returns Trend direction: IMPROVING, DECLINING, or STABLE
 */
export function computeTrend(
  values: number[],
  threshold = 5
): TrendDirection {
  // Need at least 3 values to detect a trend
  if (values.length < 3) return 'STABLE';

  // Filter out invalid values
  const validValues = values.filter(v => v != null && !isNaN(v) && isFinite(v));
  if (validValues.length < 3) return 'STABLE';

  const midpoint = Math.floor(validValues.length / 2);
  const firstHalf = validValues.slice(0, midpoint);
  const secondHalf = validValues.slice(midpoint);

  const firstAvg = healthMetricsService.average(firstHalf);
  const secondAvg = healthMetricsService.average(secondHalf);

  // Avoid division by zero
  if (firstAvg === 0) return 'STABLE';

  const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

  if (changePercent > threshold) return 'IMPROVING';
  if (changePercent < -threshold) return 'DECLINING';
  return 'STABLE';
}

/**
 * Computes trend for metrics where lower is better (e.g., resting HR).
 * Inverts the logic so a decrease is "IMPROVING".
 */
export function computeTrendInverse(
  values: number[],
  threshold = 5
): TrendDirection {
  const trend = computeTrend(values, threshold);
  if (trend === 'IMPROVING') return 'DECLINING';
  if (trend === 'DECLINING') return 'IMPROVING';
  return 'STABLE';
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────

/**
 * Detects health anomalies by comparing recent data to baselines.
 * Returns an array of detected anomalies with severity and messages.
 */
export function detectAnomalies(
  recentData: RecentHealthData,
  baselines: HealthBaselines
): HealthAnomaly[] {
  const anomalies: HealthAnomaly[] = [];

  // ── Sleep Drop Detection ────────────────────────────────────────────────────
  if (recentData.sleep.length >= 3 && baselines.sleepScore > 0) {
    const recentSleepScores = recentData.sleep
      .slice(0, 3)
      .map(s => healthMetricsService.computeSleepScoreSafe(s));
    const recentSleepAvg = healthMetricsService.average(recentSleepScores);

    // Alert if sleep score dropped 25% below baseline
    if (recentSleepAvg < baselines.sleepScore * 0.75) {
      anomalies.push({
        type: 'sleep_drop',
        severity: 'warning',
        message: `Your sleep quality has dropped 25% below your baseline (${Math.round(recentSleepAvg)} vs ${Math.round(baselines.sleepScore)}).`,
        data: {
          recent: Math.round(recentSleepAvg),
          baseline: Math.round(baselines.sleepScore),
          dropPercent: Math.round((1 - recentSleepAvg / baselines.sleepScore) * 100),
        },
      });
    }
  }

  // ── HRV Drop Detection (Recovery Concern) ───────────────────────────────────
  if (recentData.hrv.length >= 3 && baselines.hrv > 0) {
    const recentHRVValues = recentData.hrv.slice(0, 3).map(h => h.hrvRmssd);
    const recentHRVAvg = healthMetricsService.average(recentHRVValues);

    // Alert if HRV dropped 20% below baseline
    if (recentHRVAvg < baselines.hrv * 0.8) {
      anomalies.push({
        type: 'hrv_drop',
        severity: 'warning',
        message: `Your HRV is 20% below baseline (${Math.round(recentHRVAvg)} vs ${Math.round(baselines.hrv)} ms), suggesting incomplete recovery.`,
        data: {
          recent: Math.round(recentHRVAvg),
          baseline: Math.round(baselines.hrv),
          dropPercent: Math.round((1 - recentHRVAvg / baselines.hrv) * 100),
        },
      });
    }
  }

  // ── RHR Spike Detection (Illness/Stress Indicator) ──────────────────────────
  if (recentData.rhr.length >= 3 && baselines.rhr > 0) {
    const recentRHRValues = recentData.rhr.slice(0, 3).map(r => r.restingHR);
    const recentRHRAvg = healthMetricsService.average(recentRHRValues);

    // Alert if RHR is 10% above baseline
    if (recentRHRAvg > baselines.rhr * 1.1) {
      anomalies.push({
        type: 'rhr_spike',
        severity: 'alert',
        message: `Your resting heart rate is elevated (${Math.round(recentRHRAvg)} vs baseline ${Math.round(baselines.rhr)} bpm). Consider extra rest.`,
        data: {
          recent: Math.round(recentRHRAvg),
          baseline: Math.round(baselines.rhr),
          spikePercent: Math.round((recentRHRAvg / baselines.rhr - 1) * 100),
        },
      });
    }
  }

  // ── Overtraining Risk Detection ─────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyWorkouts = recentData.exercise.filter(e => {
    const workoutDate = new Date(e.startTime);
    return workoutDate >= sevenDaysAgo;
  });

  if (weeklyWorkouts.length >= 6) {
    // High training frequency
    const recentSleepScores = recentData.sleep
      .slice(0, 3)
      .map(s => healthMetricsService.computeSleepScoreSafe(s));
    const recentSleepAvg = healthMetricsService.average(recentSleepScores);

    const recentHRVValues = recentData.hrv.slice(0, 3).map(h => h.hrvRmssd);
    const recentHRVAvg = healthMetricsService.average(recentHRVValues);

    // High load + poor sleep + low HRV = overtraining risk
    if (
      recentSleepAvg < 60 &&
      baselines.hrv > 0 &&
      recentHRVAvg < baselines.hrv * 0.85
    ) {
      anomalies.push({
        type: 'overtraining_risk',
        severity: 'alert',
        message: `You've trained ${weeklyWorkouts.length} times this week with declining recovery markers. Consider a rest day.`,
        data: {
          workouts: weeklyWorkouts.length,
          sleepScore: Math.round(recentSleepAvg),
          hrv: Math.round(recentHRVAvg),
          hrvBaseline: Math.round(baselines.hrv),
        },
      });
    }
  }

  // ── Inactivity Detection ────────────────────────────────────────────────────
  if (recentData.steps.length >= 3 && baselines.dailySteps > 0) {
    const recentSteps = recentData.steps.slice(0, 3).map(s => s.totalSteps);
    const recentStepsAvg = healthMetricsService.average(recentSteps);

    // Alert if steps dropped 50% below baseline
    if (recentStepsAvg < baselines.dailySteps * 0.5) {
      anomalies.push({
        type: 'inactivity',
        severity: 'info',
        message: `Your daily steps have dropped significantly (${Math.round(recentStepsAvg)} vs baseline ${Math.round(baselines.dailySteps)}). Try to move more today.`,
        data: {
          recent: Math.round(recentStepsAvg),
          baseline: Math.round(baselines.dailySteps),
          dropPercent: Math.round((1 - recentStepsAvg / baselines.dailySteps) * 100),
        },
      });
    }
  }

  // ── Sleep Debt Detection ────────────────────────────────────────────────────
  if (recentData.sleep.length >= 5) {
    const recentSleepDurations = recentData.sleep.slice(0, 5).map(s => s.durationMinutes);
    const avgSleepDuration = healthMetricsService.average(recentSleepDurations);
    const targetSleep = 480; // 8 hours

    // Alert if averaging less than 6 hours over 5 nights
    if (avgSleepDuration < 360) {
      const sleepDebt = (targetSleep - avgSleepDuration) * 5; // Total debt over 5 nights
      anomalies.push({
        type: 'sleep_debt',
        severity: 'warning',
        message: `You're averaging only ${Math.round(avgSleepDuration / 60)}h ${Math.round(avgSleepDuration % 60)}m of sleep. You've accumulated ${Math.round(sleepDebt / 60)} hours of sleep debt.`,
        data: {
          avgDuration: Math.round(avgSleepDuration),
          targetDuration: targetSleep,
          sleepDebtMinutes: Math.round(sleepDebt),
        },
      });
    }
  }

  return anomalies;
}

/**
 * Detects anomalies with safe defaults for missing data.
 */
export function detectAnomaliesSafe(
  recentData: Partial<RecentHealthData>,
  baselines: Partial<HealthBaselines>
): HealthAnomaly[] {
  return detectAnomalies(
    {
      sleep: recentData.sleep ?? [],
      hrv: recentData.hrv ?? [],
      rhr: recentData.rhr ?? [],
      exercise: recentData.exercise ?? [],
      steps: recentData.steps ?? [],
    },
    {
      sleepScore: baselines.sleepScore ?? 0,
      hrv: baselines.hrv ?? 0,
      rhr: baselines.rhr ?? 0,
      dailySteps: baselines.dailySteps ?? 0,
    }
  );
}

// ── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Formats an anomaly for display in the AI coach context.
 */
export function formatAnomalyForContext(anomaly: HealthAnomaly): string {
  const severityEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    alert: '🚨',
  };
  return `[${severityEmoji[anomaly.severity]} ${anomaly.severity.toUpperCase()}] ${anomaly.message}`;
}

/**
 * Formats multiple anomalies for the AI coach context.
 */
export function formatAnomaliesForContext(anomalies: HealthAnomaly[]): string {
  if (anomalies.length === 0) return '';
  return anomalies.map(formatAnomalyForContext).join('\n');
}

// ── Export Service ────────────────────────────────────────────────────────────

export const healthAnalysisService = {
  // Trend detection
  computeTrend,
  computeTrendInverse,
  // Legacy anomaly detection (rule-based, fixed thresholds)
  detectAnomalies,
  detectAnomaliesSafe,
  // NEW: Statistical anomaly detection (Z-scores, EWMA baselines)
  detectStatisticalAnomalies: statisticalAnomalyService.detectAnomalies,
  // Formatting
  formatAnomalyForContext,
  formatAnomaliesForContext,
  formatStatisticalAnomalyForContext,
  formatStatisticalAnomaliesForContext,
};

// ── Statistical Anomaly Formatting ────────────────────────────────────────────

/**
 * Formats a statistical anomaly for display in the AI coach context.
 */
export function formatStatisticalAnomalyForContext(anomaly: StatisticalAnomaly): string {
  const severityEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    alert: '🚨',
  };
  const zScoreStr = anomaly.zScore != null ? ` (Z=${anomaly.zScore.toFixed(1)})` : '';
  return `[${severityEmoji[anomaly.severity]} ${anomaly.severity.toUpperCase()}${zScoreStr}] ${anomaly.message}`;
}

/**
 * Formats multiple statistical anomalies for the AI coach context.
 */
export function formatStatisticalAnomaliesForContext(anomalies: StatisticalAnomaly[]): string {
  if (anomalies.length === 0) return '';
  return anomalies.map(formatStatisticalAnomalyForContext).join('\n');
}

// ── Re-export types for convenience ───────────────────────────────────────────

export type { StatisticalAnomaly, AnomalyDetectionResult, BaselineSet };
