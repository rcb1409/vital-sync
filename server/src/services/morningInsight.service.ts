// -------------------------------------------------------
// Morning Insight Service
// -------------------------------------------------------
// Generates a short, personalized AI summary every morning
// after sleep + recovery data has been fetched.
//
// This is DIFFERENT from the chat coach:
//   - Chat coach: user asks a question → AI answers (interactive)
//   - This service: runs in background → generates a daily insight
//                   and stores it for the user to see when they open the app
//
// When anomalies are detected, we now use the AGENTIC INVESTIGATOR
// to let the LLM autonomously fetch data and determine root causes,
// rather than just formatting pre-computed data.
//
// Think of it like a fitness coach who:
//   1. Notices something is off (anomaly detection)
//   2. Pulls your workout logs, sleep data, nutrition (investigation)
//   3. Figures out WHY (root cause analysis)
//   4. Leaves you a note with specific advice (insight)
// -------------------------------------------------------

import { prisma } from '@/config/database';
import { bedrock } from '@/config/bedrock';
import { env } from '@/config/env';
import type { HealthAnomaly } from './healthAnalysis.service';
import type { HealthSummaryData } from './healthSummary.service';
import { healthMetricsService } from './healthMetrics.service';
import { anomalyInvestigatorService, type InvestigationResult } from './anomalyInvestigator.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MorningInsightResult {
  insightId: string;
  title: string;
  message: string;
  severity: string;
  investigation?: InvestigationResult;
}

// ── Main Function ─────────────────────────────────────────────────────────────

/**
 * Generates and stores a morning recovery insight for the user.
 *
 * How it works:
 *   1. Fetch the user's last sleep session from DB
 *   2. Build a short data summary (numbers only)
 *   3. Ask Claude to write a 2-3 sentence human insight
 *   4. Save the result to ProactiveInsight table
 *
 * Returns null if there's not enough data to generate an insight.
 */
async function generateMorningInsight(
  userId: string,
  weeklySummary: HealthSummaryData | null,
  anomalies: HealthAnomaly[],
): Promise<MorningInsightResult | null> {

  // ── Build data snapshot for the AI prompt ─────────────────────────────────
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Last sleep session
  const lastSleep = await prisma.healthDataPoint.findFirst({
    where: { userId, dataType: 'sleep', recordedAt: { gte: yesterday } },
    orderBy: { recordedAt: 'desc' },
  });

  // Last HRV and RHR
  const [lastHRV, lastRHR] = await Promise.all([
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'hrv', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.healthDataPoint.findFirst({
      where: { userId, dataType: 'resting_hr', recordedAt: { gte: yesterday } },
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  // Need at least sleep data to generate a meaningful insight
  if (!lastSleep) return null;

  const sleepValue = lastSleep.value as any;
  const sleepScore = healthMetricsService.computeSleepScoreSafe(sleepValue);
  const durationHours = sleepValue?.durationMinutes
    ? `${Math.floor(sleepValue.durationMinutes / 60)}h ${sleepValue.durationMinutes % 60}m`
    : 'unknown';

  const recoveryScore  = weeklySummary?.latestRecoveryScore ?? null;
  const avgHRV         = weeklySummary?.avgHRV ?? null;
  const avgRHR         = weeklySummary?.avgRestingHR ?? null;

  const todayHRV = (lastHRV?.value as any)?.hrvRmssd ?? null;
  const todayRHR = (lastRHR?.value as any)?.restingHR ?? null;

  const highestSeverity = anomalies.reduce<'info' | 'warning' | 'alert'>((max, a) => {
    const order = { info: 0, warning: 1, alert: 2 };
    return order[a.severity] > order[max] ? a.severity : max;
  }, 'info');

  // ── AGENTIC INVESTIGATION (when anomalies detected) ─────────────────────────
  // This is the "real AI engineering" — instead of just formatting data,
  // we let the LLM autonomously investigate the root cause.
  let investigation: InvestigationResult | undefined;
  let investigationInsight = '';

  if (anomalies.length > 0 && (highestSeverity === 'warning' || highestSeverity === 'alert')) {
    console.log(`🔍 Anomalies detected (${anomalies.length}), running agentic investigation...`);

    try {
      const investigations = await anomalyInvestigatorService.investigateAnomalies(
        userId,
        anomalies,
        1 // Investigate the most severe anomaly
      );

      if (investigations.length > 0) {
        investigation = investigations[0];
        investigationInsight = anomalyInvestigatorService.formatFindingAsInsight(investigation.finding);
        console.log(`✅ Investigation complete: ${investigation.finding.rootCause} (confidence: ${investigation.finding.confidence})`);
      }
    } catch (err: any) {
      console.error(`❌ Investigation failed: ${err.message}`);
      // Fall back to simple insight generation
    }
  }

  // ── Build the AI prompt ────────────────────────────────────────────────────
  const dataLines = [
    `Sleep: ${durationHours} (score: ${sleepScore}/100)`,
    sleepValue?.stages
      ? `  Stages — Deep: ${sleepValue.stages.deep ?? 0}min, REM: ${sleepValue.stages.rem ?? 0}min, Light: ${sleepValue.stages.light ?? 0}min, Awake: ${sleepValue.stages.awake ?? 0}min`
      : null,
    recoveryScore !== null ? `Recovery score: ${recoveryScore}/100` : null,
    todayHRV !== null ? `Today's HRV: ${todayHRV}ms${avgHRV ? ` (7-day avg: ${Math.round(avgHRV)}ms)` : ''}` : null,
    todayRHR !== null ? `Today's Resting HR: ${todayRHR}bpm${avgRHR ? ` (7-day avg: ${Math.round(avgRHR)}bpm)` : ''}` : null,
    anomalies.length > 0 ? `Alerts: ${anomalies.map(a => a.message).join(' | ')}` : 'No alerts.',
    investigation ? `\nInvestigation findings: ${investigationInsight}` : null,
  ].filter(Boolean).join('\n');

  // If we have investigation findings, use a more detailed prompt
  const prompt = investigation
    ? `You are a supportive fitness coach. Based on the user's health data AND the investigation findings below, write a brief morning insight in 2-3 sentences. Focus on the ROOT CAUSE identified and give specific, actionable advice. Be encouraging but honest. Do not use markdown, headers, or bullet points — just plain conversational text.

Health data:
${dataLines}`
    : `You are a supportive fitness coach. Based on the user's overnight health data, write a brief morning insight in 2-3 sentences. Be specific about the numbers, encouraging but honest. If there are alerts, address the most important one. Do not use markdown, headers, or bullet points — just plain conversational text.

Health data:
${dataLines}`;

  // ── Call Claude (single shot — no tool loop needed) ───────────────────────
  let message = '';
  try {
    const response = await bedrock.messages.create({
      model:      env.BEDROCK_MODEL_ID,
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    message = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
  } catch (err: any) {
    console.error(`❌ Morning insight LLM call failed: ${err.message}`);
    // Fallback to a data-only message if AI is unavailable
    message = buildFallbackMessage(sleepScore, recoveryScore, anomalies);
  }

  if (!message) return null;

  // ── Determine title based on recovery score ────────────────────────────────
  const title = buildTitle(recoveryScore, anomalies);

  // ── Store in ProactiveInsight table ───────────────────────────────────────
  // Don't create a duplicate if one already exists for today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.proactiveInsight.findFirst({
    where: {
      userId,
      type: 'morning_recovery',
      createdAt: { gte: todayStart },
    },
  });

  if (existing) {
    // Update the existing insight with fresh data
    await prisma.proactiveInsight.update({
      where: { id: existing.id },
      data: {
        title,
        message,
        severity: highestSeverity,
        dataSnapshot: {
          sleepScore,
          recoveryScore,
          anomaliesCount: anomalies.length,
          investigation: investigation ? {
            rootCause: investigation.finding.rootCause,
            contributingFactors: investigation.finding.contributingFactors,
            confidence: investigation.finding.confidence,
            toolsCalled: investigation.toolsCalled,
            turnsUsed: investigation.turnsUsed,
          } : null,
        } as any,
      },
    });
    return { insightId: existing.id, title, message, severity: highestSeverity, investigation };
  }

  const insight = await prisma.proactiveInsight.create({
    data: {
      userId,
      type:     'morning_recovery',
      severity: highestSeverity,
      title,
      message,
      dataSnapshot: {
        sleepScore,
        recoveryScore,
        anomaliesCount: anomalies.length,
        investigation: investigation ? {
          rootCause: investigation.finding.rootCause,
          contributingFactors: investigation.finding.contributingFactors,
          confidence: investigation.finding.confidence,
          toolsCalled: investigation.toolsCalled,
          turnsUsed: investigation.turnsUsed,
        } : null,
      } as any,
    },
  });

  return { insightId: insight.id, title, message, severity: highestSeverity, investigation };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTitle(recoveryScore: number | null, anomalies: HealthAnomaly[]): string {
  if (anomalies.some(a => a.severity === 'alert')) return 'Recovery Alert — Rest Recommended';
  if (anomalies.some(a => a.severity === 'warning')) return 'Morning Check-in — Take It Easy Today';
  if (recoveryScore !== null && recoveryScore >= 80) return 'Great Recovery — Ready to Train';
  if (recoveryScore !== null && recoveryScore >= 60) return 'Moderate Recovery — Steady Training';
  return 'Morning Recovery Summary';
}

function buildFallbackMessage(
  sleepScore: number,
  recoveryScore: number | null,
  anomalies: HealthAnomaly[]
): string {
  if (anomalies.length > 0) {
    return `Your sleep score was ${sleepScore}/100. ${anomalies[0].message}`;
  }
  if (recoveryScore !== null) {
    return `Your sleep score was ${sleepScore}/100 with a recovery score of ${recoveryScore}/100.`;
  }
  return `Your sleep score was ${sleepScore}/100.`;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const morningInsightService = {
  generateMorningInsight,
};
