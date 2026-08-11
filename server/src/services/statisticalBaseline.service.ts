// -------------------------------------------------------
// Statistical Baseline Service
// -------------------------------------------------------
// Calculates personalized baselines using industry-standard methods:
//   - EWMA (Exponentially Weighted Moving Average) for mean
//   - Rolling standard deviation for variance
//   - Handles cold start with population fallbacks
//
// Based on research from WHOOP, Oura, and Garmin:
//   - 14-day rolling window (minimum for reliable baselines)
//   - Recent data weighted more heavily (EWMA α = 0.3)
//   - Personal baselines, not population averages
// -------------------------------------------------------

import { prisma } from '@/config/database';
import { healthMetricsService } from './healthMetrics.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonalBaseline {
  metric: string;
  mean: number;
  ewmaMean: number;      // Exponentially weighted mean (recent data weighted more)
  stdDev: number;
  min: number;
  max: number;
  dataPoints: number;
  oldestDate: Date | null;
  newestDate: Date | null;
}

export interface BaselineSet {
  hrv: PersonalBaseline | null;
  restingHR: PersonalBaseline | null;
  sleepScore: PersonalBaseline | null;
  sleepDuration: PersonalBaseline | null;
  steps: PersonalBaseline | null;
  recoveryScore: PersonalBaseline | null;
  calibrationStatus: 'cold_start' | 'calibrating' | 'calibrated';
  calibrationDays: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// EWMA smoothing factor (α = 0.3 means ~30% weight on most recent day)
// This matches Oura's approach of weighting recent days more heavily
const EWMA_ALPHA = 0.3;

// Minimum days for reliable baseline (per WHOOP, Oura research)
const MIN_CALIBRATION_DAYS = 14;
const FULL_CALIBRATION_DAYS = 21;

// Default baseline window in days
const BASELINE_WINDOW_DAYS = 14;

// Population fallbacks for cold start (conservative estimates)
// These are used when user has < 7 days of data
const POPULATION_FALLBACKS = {
  hrv: { mean: 50, stdDev: 15 },           // ms, typical adult range
  restingHR: { mean: 65, stdDev: 8 },      // bpm, typical adult range
  sleepScore: { mean: 75, stdDev: 10 },    // 0-100 scale
  sleepDuration: { mean: 420, stdDev: 60 }, // minutes (7 hours)
  steps: { mean: 8000, stdDev: 3000 },     // daily steps
  recoveryScore: { mean: 70, stdDev: 15 }, // 0-100 scale
};

// ── Core Statistical Functions ────────────────────────────────────────────────

/**
 * Calculates the simple arithmetic mean of an array.
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculates the sample standard deviation.
 * Uses Bessel's correction (n-1) for sample std dev.
 */
function calculateStdDev(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const m = mean ?? calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - m, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculates Exponentially Weighted Moving Average (EWMA).
 * 
 * Formula: EWMA_t = α * x_t + (1 - α) * EWMA_{t-1}
 * 
 * With α = 0.3:
 *   - Today: 30% weight
 *   - Yesterday: 21% weight
 *   - 2 days ago: 15% weight
 *   - 7 days ago: ~3% weight
 * 
 * @param values Array of values, ordered from OLDEST to NEWEST
 * @param alpha Smoothing factor (0 < α ≤ 1), higher = more weight on recent
 */
function calculateEWMA(values: number[], alpha: number = EWMA_ALPHA): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  // Initialize EWMA with first value
  let ewma = values[0];

  // Process remaining values (oldest to newest)
  for (let i = 1; i < values.length; i++) {
    ewma = alpha * values[i] + (1 - alpha) * ewma;
  }

  return ewma;
}

/**
 * Calculates a Z-score: how many standard deviations from the mean.
 * 
 * Z = (value - mean) / stdDev
 * 
 * Interpretation:
 *   Z = 0: exactly at the mean
 *   Z = 1: one std dev above mean (~84th percentile)
 *   Z = -2: two std devs below mean (~2nd percentile)
 */
function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0; // Avoid division by zero
  return (value - mean) / stdDev;
}

// ── Baseline Calculation ──────────────────────────────────────────────────────

/**
 * Calculates a personal baseline for a single metric from an array of values.
 * 
 * @param values Array of numeric values (oldest to newest)
 * @param metric Name of the metric
 * @param dates Optional array of dates corresponding to values
 */
function calculateBaseline(
  values: number[],
  metric: string,
  dates?: Date[]
): PersonalBaseline | null {
  // Filter out invalid values
  const validValues = values.filter(v => v != null && !isNaN(v) && isFinite(v));
  
  if (validValues.length === 0) return null;

  const mean = calculateMean(validValues);
  const ewmaMean = calculateEWMA(validValues, EWMA_ALPHA);
  const stdDev = calculateStdDev(validValues, mean);

  return {
    metric,
    mean,
    ewmaMean,
    stdDev,
    min: Math.min(...validValues),
    max: Math.max(...validValues),
    dataPoints: validValues.length,
    oldestDate: dates && dates.length > 0 ? dates[0] : null,
    newestDate: dates && dates.length > 0 ? dates[dates.length - 1] : null,
  };
}

/**
 * Blends personal baseline with population fallback for cold start.
 * 
 * @param personal Personal baseline (may have few data points)
 * @param population Population fallback values
 * @param calibrationDays Number of days of personal data
 */
function blendWithPopulation(
  personal: PersonalBaseline | null,
  population: { mean: number; stdDev: number },
  calibrationDays: number
): PersonalBaseline {
  // Full cold start: use population only
  if (!personal || calibrationDays < 7) {
    return {
      metric: personal?.metric ?? 'unknown',
      mean: population.mean,
      ewmaMean: population.mean,
      stdDev: population.stdDev,
      min: population.mean - 2 * population.stdDev,
      max: population.mean + 2 * population.stdDev,
      dataPoints: 0,
      oldestDate: null,
      newestDate: null,
    };
  }

  // Partial calibration (7-14 days): blend 50/50
  if (calibrationDays < MIN_CALIBRATION_DAYS) {
    const blendRatio = calibrationDays / MIN_CALIBRATION_DAYS; // 0.5 to 1.0
    return {
      ...personal,
      mean: personal.mean * blendRatio + population.mean * (1 - blendRatio),
      ewmaMean: personal.ewmaMean * blendRatio + population.mean * (1 - blendRatio),
      stdDev: personal.stdDev * blendRatio + population.stdDev * (1 - blendRatio),
    };
  }

  // Fully calibrated: use personal only
  return personal;
}

// ── Main Service Functions ────────────────────────────────────────────────────

/**
 * Fetches and calculates all baselines for a user.
 * 
 * This is the main entry point for getting a user's personal baselines.
 * It handles:
 *   - Fetching historical data from the database
 *   - Calculating EWMA means and rolling std devs
 *   - Blending with population fallbacks for cold start
 *   - Determining calibration status
 */
async function calculateUserBaselines(
  userId: string,
  windowDays: number = BASELINE_WINDOW_DAYS
): Promise<BaselineSet> {
  const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Fetch all health data points in the window
  const dataPoints = await prisma.healthDataPoint.findMany({
    where: {
      userId,
      recordedAt: { gte: startDate },
    },
    orderBy: { recordedAt: 'asc' }, // Oldest first for EWMA calculation
  });

  // Group by data type
  const hrvData: { value: number; date: Date }[] = [];
  const rhrData: { value: number; date: Date }[] = [];
  const sleepData: { score: number; duration: number; date: Date }[] = [];
  const stepsData: { value: number; date: Date }[] = [];

  for (const dp of dataPoints) {
    const value = dp.value as Record<string, any>;
    const date = dp.recordedAt;

    switch (dp.dataType) {
      case 'hrv':
        if (value?.hrvRmssd) {
          hrvData.push({ value: value.hrvRmssd, date });
        }
        break;
      case 'resting_hr':
        if (value?.restingHR) {
          rhrData.push({ value: value.restingHR, date });
        }
        break;
      case 'sleep':
        const sleepScore = healthMetricsService.computeSleepScoreSafe(value);
        const duration = value?.durationMinutes ?? 0;
        if (sleepScore > 0) {
          sleepData.push({ score: sleepScore, duration, date });
        }
        break;
      case 'steps':
        if (value?.totalSteps) {
          stepsData.push({ value: value.totalSteps, date });
        }
        break;
    }
  }

  // Calculate unique days of data (for calibration status)
  const uniqueDays = new Set(
    dataPoints.map(dp => dp.recordedAt.toISOString().split('T')[0])
  ).size;

  // Determine calibration status
  let calibrationStatus: 'cold_start' | 'calibrating' | 'calibrated';
  if (uniqueDays < 7) {
    calibrationStatus = 'cold_start';
  } else if (uniqueDays < FULL_CALIBRATION_DAYS) {
    calibrationStatus = 'calibrating';
  } else {
    calibrationStatus = 'calibrated';
  }

  // Calculate baselines for each metric
  const hrvBaseline = calculateBaseline(
    hrvData.map(d => d.value),
    'hrv',
    hrvData.map(d => d.date)
  );

  const rhrBaseline = calculateBaseline(
    rhrData.map(d => d.value),
    'restingHR',
    rhrData.map(d => d.date)
  );

  const sleepScoreBaseline = calculateBaseline(
    sleepData.map(d => d.score),
    'sleepScore',
    sleepData.map(d => d.date)
  );

  const sleepDurationBaseline = calculateBaseline(
    sleepData.map(d => d.duration),
    'sleepDuration',
    sleepData.map(d => d.date)
  );

  const stepsBaseline = calculateBaseline(
    stepsData.map(d => d.value),
    'steps',
    stepsData.map(d => d.date)
  );

  // Blend with population fallbacks
  return {
    hrv: blendWithPopulation(hrvBaseline, POPULATION_FALLBACKS.hrv, uniqueDays),
    restingHR: blendWithPopulation(rhrBaseline, POPULATION_FALLBACKS.restingHR, uniqueDays),
    sleepScore: blendWithPopulation(sleepScoreBaseline, POPULATION_FALLBACKS.sleepScore, uniqueDays),
    sleepDuration: blendWithPopulation(sleepDurationBaseline, POPULATION_FALLBACKS.sleepDuration, uniqueDays),
    steps: blendWithPopulation(stepsBaseline, POPULATION_FALLBACKS.steps, uniqueDays),
    recoveryScore: null, // Calculated separately from other metrics
    calibrationStatus,
    calibrationDays: uniqueDays,
  };
}

/**
 * Calculates Z-score for a single value against a baseline.
 * Uses EWMA mean for comparison (weights recent data more).
 */
function calculateMetricZScore(
  value: number,
  baseline: PersonalBaseline | null
): number | null {
  if (!baseline || baseline.stdDev === 0) return null;
  return calculateZScore(value, baseline.ewmaMean, baseline.stdDev);
}

// ── Export ────────────────────────────────────────────────────────────────────

export const statisticalBaselineService = {
  // Core calculations
  calculateMean,
  calculateStdDev,
  calculateEWMA,
  calculateZScore,
  calculateBaseline,
  
  // Main functions
  calculateUserBaselines,
  calculateMetricZScore,
  
  // Constants (for testing)
  EWMA_ALPHA,
  MIN_CALIBRATION_DAYS,
  FULL_CALIBRATION_DAYS,
  POPULATION_FALLBACKS,
};
