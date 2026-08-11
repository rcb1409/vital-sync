import { describe, it, expect } from 'vitest';
import {
  computeTrend,
  computeTrendInverse,
  detectAnomalies,
  detectAnomaliesSafe,
  formatAnomalyForContext,
  type RecentHealthData,
  type HealthBaselines,
  type TrendDirection,
} from '../src/services/healthAnalysis.service';

describe('healthAnalysis.service', () => {
  // ── Trend Detection Tests ─────────────────────────────────────────────────────

  describe('computeTrend', () => {
    it('returns STABLE for arrays with fewer than 3 values', () => {
      expect(computeTrend([])).toBe('STABLE');
      expect(computeTrend([50])).toBe('STABLE');
      expect(computeTrend([50, 55])).toBe('STABLE');
    });

    it('detects IMPROVING trend when values increase', () => {
      // First half avg: 50, Second half avg: 60 → 20% increase
      const values = [45, 50, 55, 60, 65, 70];
      expect(computeTrend(values)).toBe('IMPROVING');
    });

    it('detects DECLINING trend when values decrease', () => {
      // First half avg: 70, Second half avg: 50 → ~29% decrease
      const values = [75, 70, 65, 55, 50, 45];
      expect(computeTrend(values)).toBe('DECLINING');
    });

    it('returns STABLE when change is within threshold', () => {
      // First half avg: 50, Second half avg: 51 → 2% change (below 5% threshold)
      const values = [49, 50, 51, 51, 51, 52];
      expect(computeTrend(values)).toBe('STABLE');
    });

    it('respects custom threshold', () => {
      // 10% change, should be STABLE with 15% threshold
      const values = [100, 100, 100, 110, 110, 110];
      expect(computeTrend(values, 15)).toBe('STABLE');
      expect(computeTrend(values, 5)).toBe('IMPROVING');
    });

    it('handles arrays with invalid values', () => {
      const values = [50, NaN, 55, undefined as any, 60];
      const trend = computeTrend(values);
      expect(['IMPROVING', 'DECLINING', 'STABLE']).toContain(trend);
    });
  });

  describe('computeTrendInverse', () => {
    it('inverts IMPROVING to DECLINING', () => {
      const values = [45, 50, 55, 60, 65, 70];
      expect(computeTrend(values)).toBe('IMPROVING');
      expect(computeTrendInverse(values)).toBe('DECLINING');
    });

    it('inverts DECLINING to IMPROVING', () => {
      const values = [75, 70, 65, 55, 50, 45];
      expect(computeTrend(values)).toBe('DECLINING');
      expect(computeTrendInverse(values)).toBe('IMPROVING');
    });

    it('keeps STABLE as STABLE', () => {
      const values = [50, 50, 50, 51, 51, 51];
      expect(computeTrendInverse(values)).toBe('STABLE');
    });
  });

  // ── Anomaly Detection Tests ───────────────────────────────────────────────────

  describe('detectAnomalies', () => {
    const baselineData: HealthBaselines = {
      sleepScore: 80,
      hrv: 50,
      rhr: 60,
      dailySteps: 8000,
    };

    it('returns empty array when no anomalies detected', () => {
      const recentData: RecentHealthData = {
        sleep: [
          { durationMinutes: 480, stages: { deep: 90, rem: 120, light: 255, awake: 15 } },
          { durationMinutes: 470, stages: { deep: 85, rem: 115, light: 255, awake: 15 } },
          { durationMinutes: 490, stages: { deep: 95, rem: 125, light: 255, awake: 15 } },
        ],
        hrv: [
          { hrvRmssd: 52, date: '2026-06-01' },
          { hrvRmssd: 48, date: '2026-06-02' },
          { hrvRmssd: 50, date: '2026-06-03' },
        ],
        rhr: [
          { restingHR: 59, date: '2026-06-01' },
          { restingHR: 61, date: '2026-06-02' },
          { restingHR: 60, date: '2026-06-03' },
        ],
        exercise: [],
        steps: [
          { date: '2026-06-01', totalSteps: 8500 },
          { date: '2026-06-02', totalSteps: 7800 },
          { date: '2026-06-03', totalSteps: 8200 },
        ],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      expect(anomalies).toHaveLength(0);
    });

    it('detects sleep drop anomaly', () => {
      const recentData: RecentHealthData = {
        sleep: [
          { durationMinutes: 300, stages: { deep: 30, rem: 40, light: 200, awake: 30 } },
          { durationMinutes: 280, stages: { deep: 25, rem: 35, light: 190, awake: 30 } },
          { durationMinutes: 320, stages: { deep: 35, rem: 45, light: 210, awake: 30 } },
        ],
        hrv: [],
        rhr: [],
        exercise: [],
        steps: [],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const sleepAnomaly = anomalies.find(a => a.type === 'sleep_drop');
      expect(sleepAnomaly).toBeDefined();
      expect(sleepAnomaly?.severity).toBe('warning');
    });

    it('detects HRV drop anomaly', () => {
      const recentData: RecentHealthData = {
        sleep: [],
        hrv: [
          { hrvRmssd: 35, date: '2026-06-01' },
          { hrvRmssd: 38, date: '2026-06-02' },
          { hrvRmssd: 36, date: '2026-06-03' },
        ],
        rhr: [],
        exercise: [],
        steps: [],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const hrvAnomaly = anomalies.find(a => a.type === 'hrv_drop');
      expect(hrvAnomaly).toBeDefined();
      expect(hrvAnomaly?.severity).toBe('warning');
    });

    it('detects RHR spike anomaly', () => {
      const recentData: RecentHealthData = {
        sleep: [],
        hrv: [],
        rhr: [
          { restingHR: 70, date: '2026-06-01' },
          { restingHR: 72, date: '2026-06-02' },
          { restingHR: 68, date: '2026-06-03' },
        ],
        exercise: [],
        steps: [],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const rhrAnomaly = anomalies.find(a => a.type === 'rhr_spike');
      expect(rhrAnomaly).toBeDefined();
      expect(rhrAnomaly?.severity).toBe('alert');
    });

    it('detects overtraining risk', () => {
      const now = new Date();
      const recentData: RecentHealthData = {
        sleep: [
          { durationMinutes: 300, stages: { deep: 30, rem: 40, light: 200, awake: 30 } },
          { durationMinutes: 280, stages: { deep: 25, rem: 35, light: 190, awake: 30 } },
          { durationMinutes: 320, stages: { deep: 35, rem: 45, light: 210, awake: 30 } },
        ],
        hrv: [
          { hrvRmssd: 38, date: '2026-06-01' },
          { hrvRmssd: 40, date: '2026-06-02' },
          { hrvRmssd: 39, date: '2026-06-03' },
        ],
        rhr: [],
        exercise: [
          { startTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 60 },
          { startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 45 },
          { startTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 50 },
          { startTime: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 55 },
          { startTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 40 },
          { startTime: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(), durationMinutes: 60 },
        ],
        steps: [],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const overtrainingAnomaly = anomalies.find(a => a.type === 'overtraining_risk');
      expect(overtrainingAnomaly).toBeDefined();
      expect(overtrainingAnomaly?.severity).toBe('alert');
    });

    it('detects inactivity anomaly', () => {
      const recentData: RecentHealthData = {
        sleep: [],
        hrv: [],
        rhr: [],
        exercise: [],
        steps: [
          { date: '2026-06-01', totalSteps: 2000 },
          { date: '2026-06-02', totalSteps: 2500 },
          { date: '2026-06-03', totalSteps: 1800 },
        ],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const inactivityAnomaly = anomalies.find(a => a.type === 'inactivity');
      expect(inactivityAnomaly).toBeDefined();
      expect(inactivityAnomaly?.severity).toBe('info');
    });

    it('detects sleep debt anomaly', () => {
      const recentData: RecentHealthData = {
        sleep: [
          { durationMinutes: 300, stages: { deep: 30, rem: 40, light: 200, awake: 30 } },
          { durationMinutes: 280, stages: { deep: 25, rem: 35, light: 190, awake: 30 } },
          { durationMinutes: 320, stages: { deep: 35, rem: 45, light: 210, awake: 30 } },
          { durationMinutes: 340, stages: { deep: 40, rem: 50, light: 220, awake: 30 } },
          { durationMinutes: 310, stages: { deep: 32, rem: 42, light: 206, awake: 30 } },
        ],
        hrv: [],
        rhr: [],
        exercise: [],
        steps: [],
      };

      const anomalies = detectAnomalies(recentData, baselineData);
      const sleepDebtAnomaly = anomalies.find(a => a.type === 'sleep_debt');
      expect(sleepDebtAnomaly).toBeDefined();
      expect(sleepDebtAnomaly?.severity).toBe('warning');
    });
  });

  describe('detectAnomaliesSafe', () => {
    it('handles empty data gracefully', () => {
      const anomalies = detectAnomaliesSafe({}, {});
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  // ── Formatting Tests ──────────────────────────────────────────────────────────

  describe('formatAnomalyForContext', () => {
    it('formats info anomaly correctly', () => {
      const anomaly = {
        type: 'inactivity' as const,
        severity: 'info' as const,
        message: 'Your steps are low today.',
        data: {},
      };
      const formatted = formatAnomalyForContext(anomaly);
      expect(formatted).toContain('INFO');
      expect(formatted).toContain('Your steps are low today.');
    });

    it('formats warning anomaly correctly', () => {
      const anomaly = {
        type: 'sleep_drop' as const,
        severity: 'warning' as const,
        message: 'Sleep quality dropped.',
        data: {},
      };
      const formatted = formatAnomalyForContext(anomaly);
      expect(formatted).toContain('WARNING');
    });

    it('formats alert anomaly correctly', () => {
      const anomaly = {
        type: 'rhr_spike' as const,
        severity: 'alert' as const,
        message: 'RHR is elevated.',
        data: {},
      };
      const formatted = formatAnomalyForContext(anomaly);
      expect(formatted).toContain('ALERT');
    });
  });
});
