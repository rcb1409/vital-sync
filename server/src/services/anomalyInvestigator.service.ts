// -------------------------------------------------------
// Anomaly Investigator Service
// -------------------------------------------------------
// This is the "real AI engineering" piece. When an anomaly is detected,
// instead of just formatting pre-computed data, we give the LLM tools
// and let it INVESTIGATE the root cause autonomously.
//
// The LLM decides:
//   - What data to fetch (sleep? workouts? nutrition? all of them?)
//   - How far back to look
//   - What patterns to look for
//   - What the likely root cause is
//
// This is an AGENTIC pattern — the LLM has agency to explore the data
// and reason about it, rather than just formatting what we give it.
// -------------------------------------------------------

import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { bedrock } from '@/config/bedrock';
import { env } from '@/config/env';
import { investigationTools } from './ai/tools';
import { executeToolCall, classifyError } from './ai/executor';
import type { HealthAnomaly } from './healthAnalysis.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvestigationFinding {
  anomalyType: string;
  rootCause: string;
  contributingFactors: string[];
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
  dataFetched: string[];
}

export interface InvestigationResult {
  finding: InvestigationFinding;
  rawAnalysis: string;
  toolsCalled: string[];
  turnsUsed: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_INVESTIGATION_TURNS = 6;

// ── Investigation Prompt ──────────────────────────────────────────────────────

function buildInvestigationPrompt(anomaly: HealthAnomaly): string {
  const today = new Date().toISOString().split('T')[0];

  return `You are a health data analyst investigating an anomaly in a user's health metrics.

## Detected Anomaly
Type: ${anomaly.type}
Severity: ${anomaly.severity}
Message: ${anomaly.message}
Data: ${JSON.stringify(anomaly.data)}

## Your Task
Investigate WHY this anomaly occurred by fetching relevant health data. You have access to:
- fetchHealthHistory: Get sleep, exercise, HRV, resting HR, VO2 max, or steps data
- fetchNutritionHistory: Get food intake and macro data
- getUserGoals: Get the user's fitness targets to compare against

## Investigation Strategy
1. Start by fetching data most likely related to the anomaly type
2. Look for patterns across multiple data sources
3. Compare recent data to the user's goals/targets
4. Form a hypothesis and verify it with additional data if needed

## Important
- Today's date is ${today}
- Fetch data for the past 7-14 days to see patterns
- Don't just describe the data — ANALYZE it and find the ROOT CAUSE
- Consider multiple factors: training load, sleep quality, nutrition, stress indicators

## Output Format
After your investigation, provide your findings in this EXACT JSON format (no markdown, just raw JSON):
{
  "rootCause": "brief description of the primary cause",
  "contributingFactors": ["factor 1", "factor 2", "factor 3"],
  "recommendation": "specific actionable advice",
  "confidence": "high" | "medium" | "low"
}

Begin your investigation now.`;
}

// ── Main Investigation Function ───────────────────────────────────────────────

/**
 * Investigates an anomaly using an agentic tool-calling loop.
 *
 * The LLM autonomously decides what data to fetch, analyzes patterns,
 * and returns a structured finding with root cause and recommendations.
 */
async function investigateAnomaly(
  userId: string,
  anomaly: HealthAnomaly,
): Promise<InvestigationResult | null> {
  const systemPrompt = buildInvestigationPrompt(anomaly);
  const messages: MessageParam[] = [
    { role: 'user', content: 'Begin investigation.' },
  ];
  const toolsCalled: string[] = [];
  let turnsUsed = 0;

  console.log(`🔍 Starting anomaly investigation for ${anomaly.type}...`);

  for (let turn = 0; turn < MAX_INVESTIGATION_TURNS; turn++) {
    turnsUsed++;

    const response = await bedrock.messages.create({
      model: env.BEDROCK_MODEL_ID,
      max_tokens: 2048,
      system: systemPrompt,
      tools: investigationTools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    // If the model is done (no more tool calls), extract the finding
    if (response.stop_reason !== 'tool_use') {
      const textContent = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      console.log(`✅ Investigation complete after ${turnsUsed} turns, ${toolsCalled.length} tool calls`);

      const finding = parseInvestigationFinding(textContent, anomaly, toolsCalled);
      if (!finding) {
        console.warn('⚠️ Could not parse investigation finding from LLM response');
        return null;
      }

      return {
        finding,
        rawAnalysis: textContent,
        toolsCalled,
        turnsUsed,
      };
    }

    // Execute tool calls
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use'
    );

    console.log(`  🔁 Turn ${turn + 1}: executing ${toolUseBlocks.length} tool(s)...`);

    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        try {
          const result = await executeToolCall(userId, {
            name: block.name,
            args: block.input as Record<string, any>,
          });
          toolsCalled.push(block.name);
          console.log(`    ✅ ${block.name} succeeded`);

          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          const classified = classifyError(err);
          console.warn(`    ⚠️ ${block.name} failed: ${classified.error}`);

          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(classified),
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  console.error('❌ Investigation hit MAX_TURNS without completing');
  return null;
}

// ── Parsing Helper ────────────────────────────────────────────────────────────

/**
 * Extracts the structured finding from the LLM's response.
 * Looks for JSON in the response and parses it.
 */
function parseInvestigationFinding(
  text: string,
  anomaly: HealthAnomaly,
  toolsCalled: string[],
): InvestigationFinding | null {
  // Try to find JSON in the response
  const jsonMatch = text.match(/\{[\s\S]*"rootCause"[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: create a basic finding from the text
    return {
      anomalyType: anomaly.type,
      rootCause: 'Unable to determine specific root cause',
      contributingFactors: [anomaly.message],
      recommendation: 'Consider reviewing your recent activity and recovery patterns.',
      confidence: 'low',
      dataFetched: [...new Set(toolsCalled)],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      anomalyType: anomaly.type,
      rootCause: parsed.rootCause || 'Unknown',
      contributingFactors: Array.isArray(parsed.contributingFactors)
        ? parsed.contributingFactors
        : [],
      recommendation: parsed.recommendation || 'No specific recommendation.',
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium',
      dataFetched: [...new Set(toolsCalled)],
    };
  } catch (e) {
    console.warn('Failed to parse investigation JSON:', e);
    return null;
  }
}

// ── Batch Investigation ───────────────────────────────────────────────────────

/**
 * Investigates multiple anomalies and returns findings for each.
 * Prioritizes by severity (alert > warning > info).
 */
async function investigateAnomalies(
  userId: string,
  anomalies: HealthAnomaly[],
  maxInvestigations = 2,
): Promise<InvestigationResult[]> {
  if (anomalies.length === 0) return [];

  // Sort by severity (most severe first)
  const severityOrder = { alert: 0, warning: 1, info: 2 };
  const sorted = [...anomalies].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  // Investigate top N anomalies
  const toInvestigate = sorted.slice(0, maxInvestigations);
  const results: InvestigationResult[] = [];

  for (const anomaly of toInvestigate) {
    const result = await investigateAnomaly(userId, anomaly);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

// ── Format for Insight ────────────────────────────────────────────────────────

/**
 * Formats investigation findings into a human-readable insight message.
 */
function formatFindingAsInsight(finding: InvestigationFinding): string {
  const factors = finding.contributingFactors.length > 0
    ? finding.contributingFactors.slice(0, 3).join(', ')
    : 'multiple factors';

  return `${finding.rootCause}. Contributing factors: ${factors}. ${finding.recommendation}`;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const anomalyInvestigatorService = {
  investigateAnomaly,
  investigateAnomalies,
  formatFindingAsInsight,
};
