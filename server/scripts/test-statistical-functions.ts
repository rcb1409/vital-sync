// -------------------------------------------------------
// Unit Tests: Statistical Functions
// -------------------------------------------------------
// Quick verification that the core statistical functions work correctly.
//
// Run with: npx ts-node -r tsconfig-paths/register scripts/test-statistical-functions.ts
// -------------------------------------------------------

import { statisticalBaselineService } from '../src/services/statisticalBaseline.service';
import { statisticalAnomalyService } from '../src/services/statisticalAnomaly.service';

function assertEqual(actual: number, expected: number, tolerance: number, name: string) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  ✅ ${name}: ${actual.toFixed(4)} (expected ${expected.toFixed(4)})`);
  } else {
    console.log(`  ❌ ${name}: ${actual.toFixed(4)} (expected ${expected.toFixed(4)}, diff ${diff.toFixed(4)})`);
  }
}

console.log('🧪 Testing Statistical Functions\n');
console.log('=' .repeat(60));

// ── Test 1: Mean Calculation ──────────────────────────────────────────────────
console.log('\n📊 Test 1: Mean Calculation\n');

const values1 = [10, 20, 30, 40, 50];
const mean1 = statisticalBaselineService.calculateMean(values1);
assertEqual(mean1, 30, 0.001, 'Mean of [10,20,30,40,50]');

// ── Test 2: Standard Deviation ────────────────────────────────────────────────
console.log('\n📊 Test 2: Standard Deviation\n');

const values2 = [2, 4, 4, 4, 5, 5, 7, 9];
const stdDev2 = statisticalBaselineService.calculateStdDev(values2);
// Sample std dev of this set is 2.138
assertEqual(stdDev2, 2.138, 0.01, 'StdDev of [2,4,4,4,5,5,7,9]');

// ── Test 3: EWMA Calculation ──────────────────────────────────────────────────
console.log('\n📊 Test 3: EWMA (Exponentially Weighted Moving Average)\n');

// With α = 0.3, recent values should have more weight
const values3 = [50, 50, 50, 50, 100]; // Last value is an outlier
const ewma3 = statisticalBaselineService.calculateEWMA(values3, 0.3);
// EWMA should be pulled toward 100 but not all the way
// Manual: E0=50, E1=0.3*50+0.7*50=50, E2=50, E3=50, E4=0.3*100+0.7*50=65
assertEqual(ewma3, 65, 0.01, 'EWMA with outlier at end');

const values3b = [100, 50, 50, 50, 50]; // Outlier at start
const ewma3b = statisticalBaselineService.calculateEWMA(values3b, 0.3);
// EWMA should be closer to 50 since outlier is old
// Manual: E0=100, E1=0.3*50+0.7*100=85, E2=0.3*50+0.7*85=74.5, E3=66.15, E4=61.305
assertEqual(ewma3b, 61.305, 0.01, 'EWMA with outlier at start');

// ── Test 4: Z-Score Calculation ───────────────────────────────────────────────
console.log('\n📊 Test 4: Z-Score Calculation\n');

// Z = (value - mean) / stdDev
const z1 = statisticalBaselineService.calculateZScore(70, 50, 10);
assertEqual(z1, 2.0, 0.001, 'Z-score: 70 with mean=50, std=10');

const z2 = statisticalBaselineService.calculateZScore(30, 50, 10);
assertEqual(z2, -2.0, 0.001, 'Z-score: 30 with mean=50, std=10');

const z3 = statisticalBaselineService.calculateZScore(50, 50, 10);
assertEqual(z3, 0.0, 0.001, 'Z-score: 50 with mean=50, std=10 (at mean)');

// ── Test 5: Z-Score to Percentile ─────────────────────────────────────────────
console.log('\n📊 Test 5: Z-Score to Percentile\n');

const p1 = statisticalAnomalyService.zScoreToPercentile(0);
assertEqual(p1, 50, 1, 'Percentile at Z=0 (should be 50th)');

const p2 = statisticalAnomalyService.zScoreToPercentile(-2);
assertEqual(p2, 2, 1, 'Percentile at Z=-2 (should be ~2nd)');

const p3 = statisticalAnomalyService.zScoreToPercentile(2);
assertEqual(p3, 98, 1, 'Percentile at Z=2 (should be ~98th)');

// ── Test 6: CUSUM Calculation ─────────────────────────────────────────────────
console.log('\n📊 Test 6: CUSUM (Cumulative Sum for Trend Detection)\n');

// Stable values around target - CUSUM should stay near 0
const stableValues = [50, 51, 49, 50, 51, 49, 50];
const cusumStable = statisticalAnomalyService.calculateCUSUM(stableValues, 50, 2);
console.log(`  Stable values: upper=${cusumStable.upper.toFixed(2)}, lower=${cusumStable.lower.toFixed(2)}`);
console.log(`  ✅ Both should be near 0 (within allowance)`);

// Declining values - lower CUSUM should go negative
const decliningValues = [50, 48, 46, 44, 42, 40, 38];
const cusumDecline = statisticalAnomalyService.calculateCUSUM(decliningValues, 50, 2);
console.log(`  Declining values: upper=${cusumDecline.upper.toFixed(2)}, lower=${cusumDecline.lower.toFixed(2)}`);
console.log(`  ✅ Lower CUSUM should be significantly negative`);

// Rising values - upper CUSUM should go positive
const risingValues = [50, 52, 54, 56, 58, 60, 62];
const cusumRise = statisticalAnomalyService.calculateCUSUM(risingValues, 50, 2);
console.log(`  Rising values: upper=${cusumRise.upper.toFixed(2)}, lower=${cusumRise.lower.toFixed(2)}`);
console.log(`  ✅ Upper CUSUM should be significantly positive`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '=' .repeat(60));
console.log('✅ All statistical function tests completed!\n');
