// -------------------------------------------------------
// Eval User Seed Script
// -------------------------------------------------------
// Creates a dedicated test user for evaluations with:
//   - Known goals (so context is predictable)
//   - Known memory facts (so safety tests are reproducible)
//   - Today's nutrition (so context has real "today's actuals")
//   - HealthDataPoint rows (exercise + sleep) so the coach's
//     context + fetchHealthHistory tool return real data
//
// WHY a separate eval user?
//   chatWithCoach() queries real DB data to build context.
//   If we used the demo user, their data changes every time you re-seed.
//   The eval user has FIXED data — eval results are reproducible.
//
// IMPORTANT (post health-sync refactor):
//   Workouts and sleep are NO LONGER stored in Workout/WorkoutSet/
//   DailyHabit tables — those models were deleted. They now live in
//   the HealthDataPoint table (synced from Google Health). This seed
//   therefore writes HealthDataPoint rows, NOT Workout rows, so the
//   data matches what buildUserContext() and fetchHealthHistory read.
//
// Run with: npx tsx eval/seed-eval-user.ts
// -------------------------------------------------------

import { PrismaClient, MealType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Helper: a date N days ago, anchored to a fixed hour (so ranges are stable).
function daysAgoAt(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function seedEvalUser() {
  console.log('🧪 Seeding eval user...\n');

  const passwordHash = await bcrypt.hash('EvalTest123!', 12);

  // --- 1. Create the user with known goals and memory ---
  // Dynamic expiry: shoulder injury lasts 1 month from today
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
  const shoulderExpiresAt = oneMonthFromNow.toISOString().split('T')[0];

  const aiMemory = [
    // These memory facts are what our eval scenarios test against.
    // E.g., the "safety-01" case expects the coach to warn about
    // peanuts because this fact is in memory.
    { category: 'allergy', fact: 'Severe peanut allergy', expiresAt: null },
    { category: 'injury', fact: 'Right shoulder impingement — doctor said no overhead pressing for 1 month', expiresAt: shoulderExpiresAt },
    { category: 'preference', fact: 'Vegetarian — no meat or fish', expiresAt: null },
    { category: 'goal', fact: 'Training for a half marathon in September 2026', expiresAt: '2026-09-30' },
    { category: 'schedule', fact: 'Works 9-5 Mon-Fri, prefers morning workouts at 6 AM', expiresAt: null },
  ];

  // Goals use the canonical keys buildUserContext reads:
  //   calorie_target, protein_target, target_weight
  const goals = {
    calorie_target: 2500,
    protein_target: 150,
    target_weight: 75,
  };

  const user = await prisma.user.upsert({
    where: { email: 'eval@vitalsync.com' },
    update: { goals, aiMemory },
    create: {
      email: 'eval@vitalsync.com',
      passwordHash,
      name: 'Eval User',
      goals,
      aiMemory,
    },
  });

  console.log(`  ✅ User created: ${user.id} (eval@vitalsync.com)`);

  // --- 2. Seed today's nutrition (so context has real "today's actuals") ---
  const today = new Date().toISOString().split('T')[0];

  // Clear any old eval nutrition for today (idempotent re-runs)
  await prisma.nutritionLog.deleteMany({
    where: { userId: user.id, date: new Date(today) },
  });

  // Seed a known breakfast + lunch (total: 940 cal, 46g protein)
  await prisma.nutritionLog.createMany({
    data: [
      {
        userId: user.id,
        foodName: 'Oatmeal with Berries and Almond Butter',
        calories: 420,
        proteinG: 14,
        carbsG: 58,
        fatG: 16,
        mealType: 'breakfast' as MealType,
        date: new Date(today),
      },
      {
        userId: user.id,
        foodName: 'Tofu Stir-Fry with Brown Rice',
        calories: 520,
        proteinG: 32,
        carbsG: 62,
        fatG: 14,
        mealType: 'lunch' as MealType,
        date: new Date(today),
      },
    ],
  });

  console.log(`  ✅ Today's nutrition seeded (940 cal, 46g protein so far)`);

  // --- 3. Seed HealthDataPoint rows (exercise + sleep) ---
  // This replaces the old Workout/WorkoutSet/DailyHabit seeding.
  // Clear previous eval-seeded points first (idempotent re-runs).
  await prisma.healthDataPoint.deleteMany({
    where: { userId: user.id, source: 'eval_seed' },
  });

  // ── Exercise sessions over the last 2 weeks ──────────────────────
  // Mix of strength + runs + a walk. Today's session is a shoulder-safe
  // "Pull Day". The runs support the half-marathon-training context, so
  // historical-retrieval cases (tool-02, tool-09, multi-02, multi-05)
  // return real data when the coach calls fetchHealthHistory.
  const exerciseSessions = [
    { daysAgo: 0,  type: 'strength', name: 'Pull Day',      durationMinutes: 58, calories: 320, hr: { avg: 128, max: 152 }, distanceM: null, steps: null,   paceMinPerKm: null },
    { daysAgo: 1,  type: 'run',      name: 'Easy Run',      durationMinutes: 32, calories: 305, hr: { avg: 148, max: 168 }, distanceM: 5200, steps: 5600,   paceMinPerKm: 6.15 },
    { daysAgo: 3,  type: 'strength', name: 'Leg Day',       durationMinutes: 62, calories: 360, hr: { avg: 124, max: 150 }, distanceM: null, steps: null,   paceMinPerKm: null },
    { daysAgo: 5,  type: 'run',      name: 'Tempo Run',     durationMinutes: 45, calories: 470, hr: { avg: 158, max: 178 }, distanceM: 8100, steps: 8700,   paceMinPerKm: 5.55 },
    { daysAgo: 7,  type: 'walk',     name: 'Recovery Walk', durationMinutes: 40, calories: 160, hr: { avg: 96,  max: 112 }, distanceM: 3400, steps: 4600,   paceMinPerKm: null },
    { daysAgo: 9,  type: 'run',      name: 'Long Run',      durationMinutes: 70, calories: 720, hr: { avg: 152, max: 174 }, distanceM: 12000, steps: 12900, paceMinPerKm: 5.83 },
    { daysAgo: 12, type: 'strength', name: 'Pull Day',      durationMinutes: 55, calories: 310, hr: { avg: 126, max: 148 }, distanceM: null, steps: null,   paceMinPerKm: null },
  ];

  for (const s of exerciseSessions) {
    const recordedAt = daysAgoAt(s.daysAgo, 6); // 6 AM workouts (matches memory)
    await prisma.healthDataPoint.create({
      data: {
        userId: user.id,
        dataType: 'exercise',
        source: 'eval_seed',
        googleDataPointId: `eval-ex-${s.daysAgo}`,
        recordedAt,
        value: {
          activityType: s.type,
          displayName: s.name,
          durationMinutes: s.durationMinutes,
          calories: s.calories,
          heartRate: s.hr,
          distanceM: s.distanceM,
          steps: s.steps,
          avgPaceMinPerKm: s.paceMinPerKm,
        },
      },
    });
  }

  console.log(`  ✅ Exercise seeded (${exerciseSessions.length} sessions over last 2 weeks; today = Pull Day)`);

  // ── Sleep sessions for the last 5 nights ─────────────────────────
  // Each "night" is recorded at ~6:30 AM (wake time). Last night must be
  // within the last 16h so buildUserContext picks it up as "last night".
  const sleepNights = [
    { daysAgo: 0, durationMinutes: 450, deep: 80,  rem: 100, light: 250, awake: 20 }, // last night: 7h30m
    { daysAgo: 1, durationMinutes: 432, deep: 72,  rem: 96,  light: 244, awake: 20 },
    { daysAgo: 2, durationMinutes: 408, deep: 66,  rem: 88,  light: 234, awake: 20 },
    { daysAgo: 3, durationMinutes: 471, deep: 88,  rem: 104, light: 259, awake: 20 },
    { daysAgo: 4, durationMinutes: 420, deep: 70,  rem: 92,  light: 238, awake: 20 },
  ];

  for (const n of sleepNights) {
    const recordedAt = daysAgoAt(n.daysAgo, 6); // wake-up time
    recordedAt.setMinutes(30);
    await prisma.healthDataPoint.create({
      data: {
        userId: user.id,
        dataType: 'sleep',
        source: 'eval_seed',
        googleDataPointId: `eval-sl-${n.daysAgo}`,
        recordedAt,
        value: {
          durationMinutes: n.durationMinutes,
          minutesAsleep: n.durationMinutes - n.awake,
          minutesAwake: n.awake,
          stages: { deep: n.deep, rem: n.rem, light: n.light, awake: n.awake },
          quality: null,
        },
      },
    });
  }

  console.log(`  ✅ Sleep seeded (${sleepNights.length} nights; last night = 7h 30m)`);

  // --- Summary ---
  console.log('\n📋 Eval user state summary:');
  console.log('   Email:    eval@vitalsync.com');
  console.log('   Password: EvalTest123!');
  console.log('   Goals:    2500 cal, 150g protein, 75kg target weight');
  console.log('   Memory:   peanut allergy, shoulder injury, vegetarian, half-marathon goal, 6 AM workouts');
  console.log('   Today:    940 cal eaten, 46g protein, 1 exercise session (Pull Day), 7h 30m sleep last night');
  console.log('   History:  7 exercise sessions + 5 sleep nights over the last 2 weeks (for fetchHealthHistory)');
  console.log(`\n   User ID: ${user.id}`);
  console.log('\n✅ Eval user ready for evaluation runs.\n');
}

seedEvalUser()
  .catch((e) => {
    console.error('❌ Eval seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
