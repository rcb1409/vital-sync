// -------------------------------------------------------
// Test Script: Statistical Anomaly Detection
// -------------------------------------------------------
// Demonstrates the upgraded anomaly detection using:
//   - Z-scores with personal baselines (EWMA)
//   - Compound anomalies (multi-metric patterns)
//   - CUSUM trend detection
//
// Run with: npx ts-node -r tsconfig-paths/register scripts/test-statistical-anomaly.ts
// -------------------------------------------------------

import { statisticalAnomalyService } from '../src/services/statisticalAnomaly.service';
import { statisticalBaselineService } from '../src/services/statisticalBaseline.service';
import { prisma } from '../src/config/database';

async function main() {
  console.log('🧪 Testing Statistical Anomaly Detection\n');
  console.log('=' .repeat(70));

  // Get a test user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error('❌ No users found in database. Please seed the database first.');
    process.exit(1);
  }

  console.log(`\n👤 Test user: ${user.email}\n`);

  // ── Step 1: Calculate Personal Baselines ────────────────────────────────────
  console.log('📊 STEP 1: Calculating Personal Baselines (EWMA + Rolling Std Dev)\n');
  console.log('-'.repeat(70));

  const baselines = await statisticalBaselineService.calculateUserBaselines(user.id);

  console.log(`Calibration Status: ${baselines.calibrationStatus.toUpperCase()}`);
  console.log(`Calibration Days: ${baselines.calibrationDays}\n`);

  const formatBaseline = (name: string, b: any) => {
    if (!b) return `  ${name}: No data`;
    return `  ${name}:
    Mean: ${b.mean.toFixed(2)}
    EWMA Mean: ${b.ewmaMean.toFixed(2)} (recent-weighted)
    Std Dev: ${b.stdDev.toFixed(2)}
    Range: [${b.min.toFixed(1)} - ${b.max.toFixed(1)}]
    Data Points: ${b.dataPoints}`;
  };

  console.log(formatBaseline('HRV (ms)', baselines.hrv));
  console.log(formatBaseline('Resting HR (bpm)', baselines.restingHR));
  console.log(formatBaseline('Sleep Score', baselines.sleepScore));
  console.log(formatBaseline('Sleep Duration (min)', baselines.sleepDuration));
  console.log(formatBaseline('Steps', baselines.steps));

  // ── Step 2: Run Full Anomaly Detection ──────────────────────────────────────
  console.log('\n\n📊 STEP 2: Running Statistical Anomaly Detection\n');
  console.log('-'.repeat(70));

  const result = await statisticalAnomalyService.detectAnomalies(user.id);

  // Show current metrics with Z-scores
  console.log('Current Metrics (with Z-scores):\n');

  if (result.metrics.hrv) {
    const z = result.metrics.hrv.zScore;
    const zStr = z != null ? `Z = ${z.toFixed(2)}` : 'Z = N/A';
    const status = z != null && z < -1.5 ? '⚠️' : z != null && z < -2.5 ? '🚨' : '✅';
    console.log(`  ${status} HRV: ${result.metrics.hrv.value.toFixed(1)}ms (${zStr})`);
  }

  if (result.metrics.restingHR) {
    const z = result.metrics.restingHR.zScore;
    const zStr = z != null ? `Z = ${z.toFixed(2)}` : 'Z = N/A';
    const status = z != null && z > 1.5 ? '⚠️' : z != null && z > 2.5 ? '🚨' : '✅';
    console.log(`  ${status} Resting HR: ${result.metrics.restingHR.value.toFixed(0)}bpm (${zStr})`);
  }

  if (result.metrics.sleepScore) {
    const z = result.metrics.sleepScore.zScore;
    const zStr = z != null ? `Z = ${z.toFixed(2)}` : 'Z = N/A';
    const status = z != null && z < -1.5 ? '⚠️' : z != null && z < -2.5 ? '🚨' : '✅';
    console.log(`  ${status} Sleep Score: ${result.metrics.sleepScore.value.toFixed(0)} (${zStr})`);
  }

  if (result.metrics.sleepDuration) {
    const z = result.metrics.sleepDuration.zScore;
    const zStr = z != null ? `Z = ${z.toFixed(2)}` : 'Z = N/A';
    const hours = (result.metrics.sleepDuration.value / 60).toFixed(1);
    const status = z != null && z < -1.5 ? '⚠️' : z != null && z < -2.5 ? '🚨' : '✅';
    console.log(`  ${status} Sleep Duration: ${hours}h (${zStr})`);
  }

  if (result.metrics.steps) {
    const z = result.metrics.steps.zScore;
    const zStr = z != null ? `Z = ${z.toFixed(2)}` : 'Z = N/A';
    const status = z != null && z < -2.0 ? '⚠️' : z != null && z < -3.0 ? '🚨' : '✅';
    console.log(`  ${status} Steps: ${result.metrics.steps.value.toFixed(0)} (${zStr})`);
  }

  // ── Step 3: Show Detected Anomalies ─────────────────────────────────────────
  console.log('\n\n📊 STEP 3: Detected Anomalies\n');
  console.log('-'.repeat(70));

  if (result.anomalies.length === 0) {
    console.log('✅ No anomalies detected! All metrics within normal range.\n');
  } else {
    console.log(`Found ${result.anomalies.length} anomaly/anomalies:\n`);

    for (const anomaly of result.anomalies) {
      const severityEmoji = {
        info: 'ℹ️ ',
        warning: '⚠️ ',
        alert: '🚨',
      };
      const zStr = anomaly.zScore != null ? ` (Z=${anomaly.zScore.toFixed(2)})` : '';
      
      console.log(`${severityEmoji[anomaly.severity]} [${anomaly.severity.toUpperCase()}]${zStr}`);
      console.log(`   Type: ${anomaly.type}`);
      console.log(`   ${anomaly.message}`);
      console.log('');
    }
  }

  // ── Step 4: Explain the Difference ──────────────────────────────────────────
  console.log('\n📊 COMPARISON: Old vs New Detection\n');
  console.log('-'.repeat(70));
  console.log(`
OLD (Rule-Based):
  - Fixed thresholds: "HRV dropped 20% below baseline"
  - Same threshold for everyone
  - Doesn't account for personal variance

NEW (Statistical):
  - Personal baselines: EWMA mean + rolling std dev
  - Z-score thresholds: "HRV is 2.1σ below YOUR average"
  - Adapts to each user's natural variance
  - Compound detection: HRV↓ + RHR↑ = overtraining risk
  - Trend detection: CUSUM catches gradual declines

Example:
  If your HRV normally varies ±10ms, a 15ms drop is significant (Z=-1.5)
  If your HRV normally varies ±5ms, a 15ms drop is very significant (Z=-3.0)
  
  The new system knows the difference!
`);

  await prisma.$disconnect();
}

main().catch(console.error);
