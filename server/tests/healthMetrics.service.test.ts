import { describe, it, expect } from 'vitest';
import {
  computeSleepScore,
  computeSleepScoreSafe,
  computeRecoveryScore,
  computeRecoveryScoreSafe,
  computeWeeklyTrainingLoad,
  average,
  standardDeviation,
  filterValidNumbers,
  type SleepData,
  type ExerciseData,
  type RecoveryScoreParams,
} from '../src/services/healthMetrics.service';

describe('healthMetrics.service', () => {
  // ── Sleep Score Tests ─────────────────────────────────────────────────────────

  describe('computeSleepScore', () => {
    it('returns 100 for perfect sleep (8h with ideal stages)', () => {
      const perfectSleep: SleepData = {
        durationMinutes: 480, // 8 hours
        stages: {
          deep: 90,   // 90 min deep
          rem: 120,   // 120 min REM
          light: 255, // remaining light
          awake: 15,  // minimal awake
        },
      };
      const score = computeSleepScore(perfectSleep);
      expect(score).toBeGreaterThanOrEqual(90);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('returns lower score for short sleep', () => {
      const shortSleep: SleepData = {
        durationMinutes: 300, // 5 hours
        stages: {
          deep: 45,
          rem: 60,
          light: 180,
          awake: 15,
        },
      };
      const score = computeSleepScore(shortSleep);
      expect(score).toBeLessThan(70);
      expect(score).toBeGreaterThan(0);
    });

    it('returns lower score for poor sleep quality (lots of awake time)', () => {
      const poorQualitySleep: SleepData = {
        durationMinutes: 480,
        stages: {
          deep: 30,   // Low deep sleep
          rem: 40,    // Low REM
          light: 310,
          awake: 100, // Lots of awake time
        },
      };
      const score = computeSleepScore(poorQualitySleep);
      expect(score).toBeLessThan(70); // Lower than good sleep but not terrible due to duration
    });

    it('handles zero duration gracefully', () => {
      const zeroSleep: SleepData = {
        durationMinutes: 0,
        stages: { deep: 0, rem: 0, light: 0, awake: 0 },
      };
      const score = computeSleepScore(zeroSleep);
      expect(score).toBe(0);
    });
  });

  describe('computeSleepScoreSafe', () => {
    it('handles missing stage data with duration-only scoring', () => {
      const sleepWithoutStages = {
        durationMinutes: 480,
        stages: { deep: 0, rem: 0, light: 0, awake: 0 },
      };
      const score = computeSleepScoreSafe(sleepWithoutStages);
      expect(score).toBe(75); // 8 hours = 75 points with no stage data
    });

    it('handles partial data', () => {
      const partialSleep = { durationMinutes: 360 };
      const score = computeSleepScoreSafe(partialSleep);
      expect(score).toBeGreaterThan(0);
    });
  });

  // ── Recovery Score Tests ──────────────────────────────────────────────────────

  describe('computeRecoveryScore', () => {
    it('returns high score when HRV is above baseline and RHR is below baseline', () => {
      const params: RecoveryScoreParams = {
        hrvRmssd: 55,      // Above baseline
        restingHR: 58,     // Below baseline
        sleepScore: 85,
        hrvBaseline: 50,
        rhrBaseline: 62,
      };
      const score = computeRecoveryScore(params);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it('returns lower score when HRV is below baseline', () => {
      const params: RecoveryScoreParams = {
        hrvRmssd: 35,      // Below baseline
        restingHR: 62,
        sleepScore: 70,
        hrvBaseline: 50,
        rhrBaseline: 62,
      };
      const score = computeRecoveryScore(params);
      // HRV below baseline reduces score, but sleep and RHR components still contribute
      expect(score).toBeLessThan(85);
      expect(score).toBeGreaterThan(60);
    });

    it('returns neutral score when no HRV/RHR data available', () => {
      const params: RecoveryScoreParams = {
        hrvRmssd: null,
        restingHR: null,
        sleepScore: 70,
        hrvBaseline: 0,
        rhrBaseline: 0,
      };
      const score = computeRecoveryScore(params);
      // Should be around 57 (20 + 12.5 + 24.5)
      expect(score).toBeGreaterThan(50);
      expect(score).toBeLessThan(70);
    });

    it('caps score at 100', () => {
      const params: RecoveryScoreParams = {
        hrvRmssd: 100,     // Way above baseline
        restingHR: 45,     // Way below baseline
        sleepScore: 100,
        hrvBaseline: 50,
        rhrBaseline: 65,
      };
      const score = computeRecoveryScore(params);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('computeRecoveryScoreSafe', () => {
    it('handles empty params', () => {
      const score = computeRecoveryScoreSafe({});
      expect(score).toBeGreaterThan(0);
    });
  });

  // ── Training Load Tests ───────────────────────────────────────────────────────

  describe('computeWeeklyTrainingLoad', () => {
    it('returns zeros for empty workout array', () => {
      const load = computeWeeklyTrainingLoad([]);
      expect(load.totalMinutes).toBe(0);
      expect(load.totalCalories).toBe(0);
      expect(load.sessionCount).toBe(0);
      expect(load.varietyScore).toBe(0);
    });

    it('correctly sums workout totals', () => {
      const workouts: ExerciseData[] = [
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-01T10:00:00Z' },
        { activityType: 'strength', durationMinutes: 45, calories: 200, startTime: '2026-06-02T10:00:00Z' },
        { activityType: 'walk', durationMinutes: 60, calories: 150, startTime: '2026-06-03T10:00:00Z' },
      ];
      const load = computeWeeklyTrainingLoad(workouts);
      expect(load.totalMinutes).toBe(135);
      expect(load.totalCalories).toBe(650);
      expect(load.sessionCount).toBe(3);
    });

    it('calculates variety score based on unique activity types', () => {
      const singleTypeWorkouts: ExerciseData[] = [
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-01T10:00:00Z' },
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-02T10:00:00Z' },
      ];
      const load1 = computeWeeklyTrainingLoad(singleTypeWorkouts);
      expect(load1.varietyScore).toBe(25); // 1 type = 25

      const mixedWorkouts: ExerciseData[] = [
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-01T10:00:00Z' },
        { activityType: 'strength', durationMinutes: 45, calories: 200, startTime: '2026-06-02T10:00:00Z' },
        { activityType: 'walk', durationMinutes: 60, calories: 150, startTime: '2026-06-03T10:00:00Z' },
      ];
      const load2 = computeWeeklyTrainingLoad(mixedWorkouts);
      expect(load2.varietyScore).toBe(75); // 3 types = 75
    });

    it('counts workout types correctly', () => {
      const workouts: ExerciseData[] = [
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-01T10:00:00Z' },
        { activityType: 'run', durationMinutes: 30, calories: 300, startTime: '2026-06-02T10:00:00Z' },
        { activityType: 'strength', durationMinutes: 45, calories: 200, startTime: '2026-06-03T10:00:00Z' },
      ];
      const load = computeWeeklyTrainingLoad(workouts);
      expect(load.workoutTypes).toEqual({ run: 2, strength: 1 });
    });

    it('calculates intensity score from HR zones', () => {
      const workoutsWithZones: ExerciseData[] = [
        {
          activityType: 'run',
          durationMinutes: 60,
          calories: 500,
          startTime: '2026-06-01T10:00:00Z',
          heartRateZones: {
            lightMins: 10,
            moderateMins: 20,
            vigorousMins: 20,
            peakMins: 10,
          },
        },
      ];
      const load = computeWeeklyTrainingLoad(workoutsWithZones);
      expect(load.intensityScore).toBeGreaterThan(50); // Should be above moderate
    });
  });

  // ── Utility Function Tests ────────────────────────────────────────────────────

  describe('average', () => {
    it('returns 0 for empty array', () => {
      expect(average([])).toBe(0);
    });

    it('calculates average correctly', () => {
      expect(average([10, 20, 30])).toBe(20);
      expect(average([5])).toBe(5);
    });
  });

  describe('standardDeviation', () => {
    it('returns 0 for arrays with fewer than 2 elements', () => {
      expect(standardDeviation([])).toBe(0);
      expect(standardDeviation([5])).toBe(0);
    });

    it('calculates standard deviation correctly', () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] has mean 5 and std dev 2
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const std = standardDeviation(values);
      expect(std).toBeCloseTo(2, 0);
    });
  });

  describe('filterValidNumbers', () => {
    it('filters out null and undefined values', () => {
      const values = [1, null, 2, undefined, 3, NaN];
      const filtered = filterValidNumbers(values);
      expect(filtered).toEqual([1, 2, 3]);
    });

    it('returns empty array for all invalid values', () => {
      expect(filterValidNumbers([null, undefined, NaN])).toEqual([]);
    });
  });
});
