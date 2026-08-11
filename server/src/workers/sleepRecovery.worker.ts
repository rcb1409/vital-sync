// -------------------------------------------------------
// Sleep Recovery Worker
// -------------------------------------------------------
// This worker runs in the BACKGROUND — not triggered by a user request.
//
// When is it triggered?
//   The webhook handler adds a "fetch-recovery" job to the queue
//   with a 20-minute delay. When that timer expires, THIS function runs.
//
// What does it do?
//   1. Fetch HRV + Resting HR from Google (now available after sleep)
//   2. Calculate recovery scores and update HealthSummary
//   3. Detect anomalies
//   4. Ask the AI to generate a morning insight
//   5. Adjust today's goals based on recovery state
//
// Think of it like an alarm clock:
//   The webhook sets the alarm ("ring in 20 minutes for user X")
//   This worker is the alarm — it wakes up and does the work
// -------------------------------------------------------

import { Worker, Job } from 'bullmq';
import { bullMQConnection } from '../config/queue';
import { googleHealthService } from '../services/googleHealth.service';
import { healthSummaryService } from '../services/healthSummary.service';
import { healthAnalysisService } from '../services/healthAnalysis.service';
import { morningInsightService } from '../services/morningInsight.service';
import { goalAdjustmentService } from '../services/goalAdjustment.service';
import { prisma } from '../config/database';

// ── Job Payload Types ─────────────────────────────────────────────────────────

export interface FetchRecoveryJobData {
  userId: string;
}

// ── Worker Definition ─────────────────────────────────────────────────────────

/**
 * The worker listens on the "sleep-recovery" queue.
 * BullMQ calls the processor function each time a job is ready to run.
 */
export function createSleepRecoveryWorker() {
  const worker = new Worker<FetchRecoveryJobData>(
    'sleep-recovery',
    async (job: Job<FetchRecoveryJobData>) => {
      const { userId } = job.data;

      console.log(`🔄 Sleep recovery worker: starting for user ${userId} (job ${job.id})`);

      // ── Step 1: Fetch HRV + Resting HR from Google ────────────────────────
      // These metrics are now calculated by Google from last night's sleep data
      console.log(`  [1/5] Fetching HRV + Resting HR for user ${userId}...`);

      const endTime   = new Date();
      const startTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // last 2 days

      const [rhrData, hrvData] = await Promise.allSettled([
        googleHealthService.fetchRestingHeartRateData(userId, startTime, endTime),
        googleHealthService.fetchHRVData(userId, startTime, endTime),
      ]);

      // Store RHR data points
      let rhrSynced = 0;
      if (rhrData.status === 'fulfilled') {
        const rhrPoints: any[] = (rhrData.value as any)?.dataPoints ?? [];
        for (const dp of rhrPoints) {
          const rhrValue = dp.dailyRestingHeartRate ?? {};
          const date = rhrValue.date;
          if (!date) continue;

          const dateStr = date && typeof date === 'object'
            ? `${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`
            : String(date);

          const value = {
            date: dateStr,
            restingHR: rhrValue.beatsPerMinute ? parseInt(String(rhrValue.beatsPerMinute)) : null,
          };
          if (!value.restingHR) continue;

          const dedupeKey = `gh-rhr-${userId}-${dateStr}`;
          await prisma.healthDataPoint.upsert({
            where:  { googleDataPointId: dedupeKey },
            update: { value },
            create: { userId, dataType: 'resting_hr', value, recordedAt: new Date(dateStr), source: 'google_health', googleDataPointId: dedupeKey },
          });
          rhrSynced++;
        }
      }

      // Store HRV data points
      let hrvSynced = 0;
      if (hrvData.status === 'fulfilled') {
        const hrvPoints: any[] = (hrvData.value as any)?.dataPoints ?? [];
        for (const dp of hrvPoints) {
          const hrvValue = dp.dailyHeartRateVariability ?? {};
          const date = hrvValue.date;
          if (!date) continue;

          const dateStr = date && typeof date === 'object'
            ? `${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`
            : String(date);

          const rmssd = hrvValue.averageHeartRateVariabilityMilliseconds ?? null;
          if (!rmssd) continue;

          const value = {
            date: dateStr,
            hrvRmssd: parseFloat(String(rmssd)),
            deepSleepRmssd: hrvValue.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds
              ? parseFloat(String(hrvValue.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds))
              : null,
            entropy: hrvValue.entropy ? parseFloat(String(hrvValue.entropy)) : null,
          };

          const dedupeKey = `gh-hrv-${userId}-${dateStr}`;
          await prisma.healthDataPoint.upsert({
            where:  { googleDataPointId: dedupeKey },
            update: { value },
            create: { userId, dataType: 'hrv', value, recordedAt: new Date(dateStr), source: 'google_health', googleDataPointId: dedupeKey },
          });
          hrvSynced++;
        }
      }

      console.log(`  [1/5] Done — RHR: ${rhrSynced} point(s), HRV: ${hrvSynced} point(s)`);

      // ── Step 2: Recalculate all scores + update HealthSummary ─────────────
      // updateAllSummaries reads from DB (now includes fresh HRV/RHR) and
      // recomputes Sleep Score, Recovery Score, trends, and training load
      console.log(`  [2/5] Recalculating health summary for user ${userId}...`);
      await healthSummaryService.updateAllSummaries(userId);
      console.log(`  [2/5] Done`);

      // ── Step 3: Run anomaly detection (UPGRADED: Statistical Z-scores) ────
      console.log(`  [3/5] Running statistical anomaly detection for user ${userId}...`);

      const weeklySummary = await healthSummaryService.getHealthSummary(userId, 'weekly');

      // NEW: Use statistical anomaly detection with Z-scores and personal baselines
      const statisticalResult = await healthAnalysisService.detectStatisticalAnomalies(userId);
      
      // Convert statistical anomalies to the format expected by morningInsightService
      // This maintains backward compatibility while using the new detection
      const anomalies = statisticalResult.anomalies.map(sa => ({
        type: sa.type as any,
        severity: sa.severity,
        message: sa.message,
        data: {
          ...sa.data,
          zScore: sa.zScore,
        },
      }));

      const calibrationStatus = statisticalResult.baselines.calibrationStatus;
      console.log(`  [3/5] Done — ${anomalies.length} anomaly/anomalies detected (calibration: ${calibrationStatus}, ${statisticalResult.baselines.calibrationDays} days)`);

      // Log Z-scores for debugging
      if (statisticalResult.metrics.hrv?.zScore != null) {
        console.log(`       HRV: ${statisticalResult.metrics.hrv.value}ms (Z=${statisticalResult.metrics.hrv.zScore.toFixed(2)})`);
      }
      if (statisticalResult.metrics.restingHR?.zScore != null) {
        console.log(`       RHR: ${statisticalResult.metrics.restingHR.value}bpm (Z=${statisticalResult.metrics.restingHR.zScore.toFixed(2)})`);
      }

      // ── Step 4: Generate AI morning insight ───────────────────────────────
      console.log(`  [4/5] Generating morning insight for user ${userId}...`);
      await morningInsightService.generateMorningInsight(userId, weeklySummary, anomalies);
      console.log(`  [4/5] Done`);

      // ── Step 5: Adjust today's goals ──────────────────────────────────────
      console.log(`  [5/5] Adjusting daily goals for user ${userId}...`);
      await goalAdjustmentService.adjustDailyGoals(userId, weeklySummary);
      console.log(`  [5/5] Done`);

      console.log(`✅ Sleep recovery pipeline complete for user ${userId}`);
    },
    {
      connection: bullMQConnection,
      concurrency: 5,  // process up to 5 users simultaneously
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ Sleep recovery job failed (id=${job?.id}): ${err.message}`);
  });

  return worker;
}
