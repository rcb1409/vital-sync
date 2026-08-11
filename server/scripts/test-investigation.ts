// -------------------------------------------------------
// Test Script: Anomaly Investigation
// -------------------------------------------------------
// This script simulates an anomaly and runs the agentic investigation
// to demonstrate the LLM autonomously fetching data and analyzing it.
//
// Run with: npx ts-node -r tsconfig-paths/register scripts/test-investigation.ts
// -------------------------------------------------------

import { anomalyInvestigatorService } from '../src/services/anomalyInvestigator.service';
import type { HealthAnomaly } from '../src/services/healthAnalysis.service';
import { prisma } from '../src/config/database';

async function main() {
  console.log('🧪 Testing Anomaly Investigation Service\n');
  console.log('=' .repeat(60));

  // Get a test user (first user in the database)
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error('❌ No users found in database. Please seed the database first.');
    process.exit(1);
  }

  console.log(`\n👤 Test user: ${user.email}\n`);

  // Simulate an HRV drop anomaly
  const simulatedAnomaly: HealthAnomaly = {
    type: 'hrv_drop',
    severity: 'warning',
    message: 'Your HRV is 25% below baseline (35ms vs 47ms), suggesting incomplete recovery.',
    data: {
      recent: 35,
      baseline: 47,
      dropPercent: 25,
    },
  };

  console.log('📊 Simulated Anomaly:');
  console.log(`   Type: ${simulatedAnomaly.type}`);
  console.log(`   Severity: ${simulatedAnomaly.severity}`);
  console.log(`   Message: ${simulatedAnomaly.message}`);
  console.log('\n' + '=' .repeat(60));
  console.log('\n🔍 Starting agentic investigation...\n');

  const startTime = Date.now();

  try {
    const result = await anomalyInvestigatorService.investigateAnomaly(
      user.id,
      simulatedAnomaly
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!result) {
      console.log('❌ Investigation returned no result');
      return;
    }

    console.log('\n' + '=' .repeat(60));
    console.log('✅ INVESTIGATION COMPLETE');
    console.log('=' .repeat(60));

    console.log(`\n⏱️  Time: ${elapsed}s`);
    console.log(`🔄 Turns used: ${result.turnsUsed}`);
    console.log(`🔧 Tools called: ${result.toolsCalled.join(', ')}`);

    console.log('\n📋 FINDINGS:');
    console.log('-'.repeat(40));
    console.log(`Root Cause: ${result.finding.rootCause}`);
    console.log(`Confidence: ${result.finding.confidence}`);
    console.log('\nContributing Factors:');
    result.finding.contributingFactors.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f}`);
    });
    console.log(`\nRecommendation: ${result.finding.recommendation}`);

    console.log('\n📝 RAW ANALYSIS:');
    console.log('-'.repeat(40));
    console.log(result.rawAnalysis);

  } catch (err: any) {
    console.error(`\n❌ Investigation failed: ${err.message}`);
    console.error(err.stack);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
