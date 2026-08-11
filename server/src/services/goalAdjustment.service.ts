// -------------------------------------------------------
// Goal Adjustment Service
// -------------------------------------------------------
// Adjusts the user's daily goals each morning based on recovery score.
//
// Why?
//   Your calorie and workout targets should not be fixed every day.
//   On days you're well-recovered, you can push harder (more calories burned).
//   On days you're fatigued, you should rest (fewer calories needed, no hard training).
//
// This is stored inside the existing User.goals JSON field — no schema change needed.
// New fields added to goals:
//   todayRecommendation: "train" | "light" | "rest"
//   adjustedCalorieTarget: number   (today's adjusted calorie goal)
//   recoveryScore: number           (the score that drove this decision)
//   goalsAdjustedAt: string         (ISO date — so we only adjust once per day)
// -------------------------------------------------------

import { prisma } from '@/config/database';
import type { HealthSummaryData } from './healthSummary.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrainingRecommendation = 'train' | 'light' | 'rest';

export interface DailyGoalAdjustment {
  recommendation: TrainingRecommendation;
  adjustedCalorieTarget: number;
  recoveryScore: number;
  reason: string;
}

// ── Rules ─────────────────────────────────────────────────────────────────────
//
// Recovery Score → What should you do today?
//
//   > 80  → TRAIN    (you're well recovered, push it)
//   60-80 → LIGHT    (decent recovery, moderate activity)
//   < 60  → REST     (body needs recovery, take a rest day)
//
// Calorie adjustment:
//   REST  → -200 kcal (resting burns fewer calories than training)
//   LIGHT → -100 kcal
//   TRAIN → 0 kcal    (no change)

const RULES = [
  { minScore: 80,  recommendation: 'train' as TrainingRecommendation, calorieAdjust: 0,    reason: 'Your recovery is excellent. This is a great day for a hard session.' },
  { minScore: 60,  recommendation: 'light' as TrainingRecommendation, calorieAdjust: -100, reason: 'Decent recovery. Keep training moderate — avoid max effort today.' },
  { minScore: 0,   recommendation: 'rest'  as TrainingRecommendation, calorieAdjust: -200, reason: 'Your body is still recovering. Prioritize rest, light movement, and sleep tonight.' },
];

// ── Main Function ─────────────────────────────────────────────────────────────

/**
 * Adjusts today's goals for a user based on their recovery score.
 *
 * How it works:
 *   1. Read the user's base calorie target from User.goals
 *   2. Apply recovery-based adjustment rules
 *   3. Write the recommendation back into User.goals
 *   4. Only runs once per day (checked via goalsAdjustedAt field)
 */
async function adjustDailyGoals(
  userId: string,
  weeklySummary: HealthSummaryData | null,
): Promise<DailyGoalAdjustment | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { goals: true },
  });
  if (!user) return null;

  const goals = (user.goals ?? {}) as Record<string, any>;

  // Only adjust once per day — skip if already done today
  const today = new Date().toISOString().split('T')[0];
  if (goals.goalsAdjustedAt === today) {
    return null; // already adjusted today
  }

  const recoveryScore = weeklySummary?.latestRecoveryScore ?? null;

  // If we don't have a recovery score yet, mark as "train" (neutral default)
  if (recoveryScore === null) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        goals: {
          ...goals,
          todayRecommendation:   'train',
          adjustedCalorieTarget: goals.calorie_target ?? goals.calories ?? 2500,
          recoveryScore:         null,
          goalsAdjustedAt:       today,
        },
      },
    });
    return null;
  }

  // Find the applicable rule
  const rule = RULES.find(r => recoveryScore >= r.minScore)!;

  const baseCalories     = goals.calorie_target ?? goals.calories ?? 2500;
  const adjustedCalories = Math.max(1500, baseCalories + rule.calorieAdjust); // floor at 1500

  const adjustment: DailyGoalAdjustment = {
    recommendation:       rule.recommendation,
    adjustedCalorieTarget: adjustedCalories,
    recoveryScore,
    reason:               rule.reason,
  };

  // Write back into the same goals JSON field
  await prisma.user.update({
    where: { id: userId },
    data: {
      goals: {
        ...goals,
        todayRecommendation:   adjustment.recommendation,
        adjustedCalorieTarget: adjustment.adjustedCalorieTarget,
        recoveryScore:         adjustment.recoveryScore,
        goalsAdjustedAt:       today,
      },
    },
  });

  console.log(
    `  Goals adjusted for user ${userId}: ` +
    `recovery=${recoveryScore} → ${adjustment.recommendation} ` +
    `(calories: ${baseCalories} → ${adjustedCalories})`
  );

  return adjustment;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const goalAdjustmentService = {
  adjustDailyGoals,
};
