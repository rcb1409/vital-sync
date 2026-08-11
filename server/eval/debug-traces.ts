// Quick debug script to inspect how traces/observations look in Langfuse
// Run: npx tsx eval/debug-traces.ts

import { LangfuseClient } from '@langfuse/client';
import dotenv from 'dotenv';

dotenv.config();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
});

async function debug() {
  console.log('\n🔍 Fetching recent traces...\n');

  // Fetch recent traces
  const tracesResponse = await langfuse.api.trace.list({ limit: 3, orderBy: 'timestamp' });
  const traces = tracesResponse.data;

  for (const trace of traces) {
    console.log('═══════════════════════════════════════════');
    console.log(`Trace: ${trace.id}`);
    console.log(`  name:      ${trace.name}`);
    console.log(`  input:     ${JSON.stringify(trace.input)?.slice(0, 120)}`);
    console.log(`  output:    ${JSON.stringify(trace.output)?.slice(0, 120)}`);
    console.log(`  metadata:  ${JSON.stringify(trace.metadata)?.slice(0, 200)}`);
    console.log(`  tags:      ${JSON.stringify(trace.tags)}`);
    console.log(`  scores:    ${JSON.stringify(trace.scores)?.slice(0, 200)}`);
    console.log(`  version:   ${trace.version}`);

    // Fetch observations for this trace
    console.log('\n  📎 Observations:');
    const observationsResponse = await langfuse.api.observations.getMany({ traceId: trace.id });
    const observations = observationsResponse.data;

    for (const obs of observations) {
      console.log(`\n  ── Observation: ${obs.id}`);
      console.log(`     type:     ${obs.type}`);
      console.log(`     name:     ${obs.name}`);
      console.log(`     model:    ${obs.providedModelName || obs.modelId || ''}`);
      console.log(`     input:    ${JSON.stringify(obs.input)?.slice(0, 120)}`);
      console.log(`     output:   ${JSON.stringify(obs.output)?.slice(0, 120)}`);
      console.log(`     metadata: ${JSON.stringify(obs.metadata)?.slice(0, 200)}`);
      console.log(`     usage:    ${JSON.stringify(obs.usageDetails)}`);
    }

    console.log('\n');
  }

  // Check if evaluators exist
  console.log('═══════════════════════════════════════════');
  console.log('🧪 Checking evaluator configs...\n');

  try {
    // The Langfuse SDK may not have a direct method for this,
    // but we can try the REST API
    const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64');

    const evalRes = await fetch(`${baseUrl}/api/public/v2/evaluator-configs`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (evalRes.ok) {
      const evalData = await evalRes.json();
      console.log(`Found ${evalData.data?.length ?? 0} evaluator configs:`);
      for (const ev of evalData.data ?? []) {
        console.log(`  - ${ev.evalTemplateName || ev.name} | status: ${ev.status} | targetObject: ${ev.targetObject} | filter: ${JSON.stringify(ev.filter)?.slice(0, 150)}`);
      }
    } else {
      console.log(`Evaluator configs API: ${evalRes.status} ${evalRes.statusText}`);
      const body = await evalRes.text();
      console.log(`  Response: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.log(`Could not fetch evaluator configs: ${(err as Error).message}`);
  }

  // Check recent scores
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Recent scores...\n');

  try {
    const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64');

    const scoresRes = await fetch(`${baseUrl}/api/public/scores?limit=10`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (scoresRes.ok) {
      const scoresData = await scoresRes.json();
      console.log(`Found ${scoresData.data?.length ?? 0} recent scores:`);
      for (const s of scoresData.data ?? []) {
        console.log(`  - ${s.name}: ${s.value} (traceId: ${s.traceId?.slice(0, 12)}..., source: ${s.source})`);
      }
    } else {
      console.log(`Scores API: ${scoresRes.status}`);
    }
  } catch (err) {
    console.log(`Could not fetch scores: ${(err as Error).message}`);
  }

  // v5 LangfuseClient doesn't need explicit shutdown
}

debug().catch(console.error);
