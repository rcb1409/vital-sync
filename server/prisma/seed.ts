// -------------------------------------------------------
// Database Seed Script
// -------------------------------------------------------
// Populates the database with a demo user + 30 days of
// realistic fake data:
//   - Body weight (trending downward slightly)
//   - Nutrition logs (3-5 meals per day)
//   - HealthDataPoints for workouts (run / walk / strength)
//   - HealthDataPoints for sleep sessions
//
// Run with: npx prisma db seed
// -------------------------------------------------------

import { PrismaClient, MealType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// =====================================================
// Demo User
// =====================================================
async function seedDemoUser() {
  const passwordHash = await bcrypt.hash('Demo123!', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@vitalsync.com' },
    update: {},
    create: {
      email: 'demo@vitalsync.com',
      passwordHash,
      name: 'Alex Demo',
      goals: {
        calorie_target: 2600,
        protein_target: 180,
        target_weight: 80,
      },
    },
  });

  const today = new Date();

  // ── 30 days of body weight ──────────────────────────────────────────────
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const baseWeight = 83.5 - (29 - i) * 0.037; // slow downward trend
    const fluctuation = (Math.random() - 0.5) * 0.6;
    const weight = Math.round((baseWeight + fluctuation) * 10) / 10;

    await prisma.bodyMetric.upsert({
      where: { userId_date: { userId: user.id, date: new Date(date.toISOString().split('T')[0]) } },
      update: {},
      create: {
        userId: user.id,
        weightKg: weight,
        date: new Date(date.toISOString().split('T')[0]),
      },
    });
  }

  // ── 30 days of nutrition logs ───────────────────────────────────────────
  const mealTemplates = [
    { food: 'Oatmeal with Berries',    cal: 350, p: 12, c: 55, f: 8,  meal: 'breakfast' as MealType },
    { food: 'Protein Shake',           cal: 280, p: 40, c: 15, f: 5,  meal: 'breakfast' as MealType },
    { food: 'Eggs and Toast',          cal: 420, p: 28, c: 30, f: 22, meal: 'breakfast' as MealType },
    { food: 'Chicken and Rice',        cal: 550, p: 45, c: 60, f: 10, meal: 'lunch' as MealType },
    { food: 'Turkey Sandwich',         cal: 480, p: 35, c: 45, f: 15, meal: 'lunch' as MealType },
    { food: 'Salmon Bowl',             cal: 620, p: 40, c: 55, f: 22, meal: 'lunch' as MealType },
    { food: 'Steak and Vegetables',    cal: 650, p: 50, c: 20, f: 35, meal: 'dinner' as MealType },
    { food: 'Pasta with Meat Sauce',   cal: 580, p: 30, c: 70, f: 18, meal: 'dinner' as MealType },
    { food: 'Grilled Chicken Salad',   cal: 450, p: 42, c: 15, f: 25, meal: 'dinner' as MealType },
    { food: 'Greek Yogurt',            cal: 150, p: 15, c: 12, f: 5,  meal: 'snack'   as MealType },
    { food: 'Protein Bar',             cal: 220, p: 20, c: 25, f: 8,  meal: 'snack'   as MealType },
    { food: 'Mixed Nuts',              cal: 180, p: 6,  c: 8,  f: 16, meal: 'snack'   as MealType },
  ];

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const numEntries = 3 + Math.floor(Math.random() * 3); // 3-5 per day
    const dayMeals = [...mealTemplates].sort(() => Math.random() - 0.5).slice(0, numEntries);

    for (const m of dayMeals) {
      await prisma.nutritionLog.create({
        data: {
          userId: user.id,
          foodName: m.food,
          calories: m.cal + Math.floor((Math.random() - 0.5) * 50),
          proteinG: m.p   + Math.floor((Math.random() - 0.5) * 5),
          carbsG:   m.c   + Math.floor((Math.random() - 0.5) * 10),
          fatG:     m.f   + Math.floor((Math.random() - 0.5) * 5),
          mealType: m.meal,
          date: new Date(dateStr),
        },
      });
    }
  }

  // ── 30 nights of sleep (Google Health style) ───────────────────────────
  // Each night gets one HealthDataPoint with dataType="sleep".
  // value shape: { durationMinutes, stages: { deep, rem, light, awake } }
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    const totalMinutes = isWeekend
      ? 420 + Math.floor(Math.random() * 60)   // 7-8 hrs on weekends
      : 330 + Math.floor(Math.random() * 90);  // 5.5-7 hrs on weekdays

    const deepMin  = Math.floor(totalMinutes * (0.12 + Math.random() * 0.08)); // 12-20%
    const remMin   = Math.floor(totalMinutes * (0.18 + Math.random() * 0.07)); // 18-25%
    const lightMin = Math.floor(totalMinutes * (0.45 + Math.random() * 0.10)); // 45-55%
    const awakeMin = totalMinutes - deepMin - remMin - lightMin;

    // Sleep starts around 10pm-midnight
    const sleepStart = new Date(date);
    sleepStart.setDate(sleepStart.getDate() - 1); // previous evening
    sleepStart.setHours(22 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0);

    const sleepEnd = new Date(sleepStart.getTime() + totalMinutes * 60 * 1000);

    await prisma.healthDataPoint.upsert({
      where: { googleDataPointId: `seed-sleep-${user.id}-day${i}` },
      update: {},
      create: {
        userId: user.id,
        dataType: 'sleep',
        value: {
          durationMinutes: totalMinutes,
          stages: { deep: deepMin, rem: remMin, light: lightMin, awake: awakeMin },
          startTime: sleepStart.toISOString(),
          endTime:   sleepEnd.toISOString(),
          quality:   isWeekend ? 4 : 2 + Math.ceil(Math.random() * 3),
        },
        recordedAt: sleepEnd,
        source: 'google_health',
        googleDataPointId: `seed-sleep-${user.id}-day${i}`,
      },
    });
  }

  // ── ~22 workout sessions over 30 days ──────────────────────────────────
  // Mix of run, walk, strength — skip Sundays, sometimes skip Wednesday.
  // value shape for exercise:
  //   { activityType, durationMinutes, calories, heartRate: { avg, max }, distanceM? }

  type ActivityType = 'run' | 'walk' | 'strength';
  const workoutCycle: ActivityType[] = [
    'strength', 'run',      'strength',
    'walk',     'strength', 'run',
    'strength', 'walk',     'strength',
    'run',      'strength', 'walk',
  ];
  let cycleIndex = 0;

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dow = date.getDay(); // 0=Sun, 6=Sat

    if (dow === 0) continue;                               // always rest on Sunday
    if (dow === 3 && Math.random() > 0.4) continue;       // often rest on Wednesday

    const activityType = workoutCycle[cycleIndex % workoutCycle.length];
    cycleIndex++;

    // Workout starts between 6am and 9am
    const startTime = new Date(date);
    startTime.setHours(6 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);

    let durationMinutes: number;
    let calories: number;
    let heartRateAvg: number;
    let heartRateMax: number;
    let distanceM: number | undefined;

    if (activityType === 'run') {
      durationMinutes = 25 + Math.floor(Math.random() * 20);  // 25-45 min
      calories        = 280 + Math.floor(Math.random() * 120);
      heartRateAvg    = 148 + Math.floor(Math.random() * 15);
      heartRateMax    = heartRateAvg + 12 + Math.floor(Math.random() * 10);
      distanceM       = Math.floor(durationMinutes * 155 + Math.random() * 500); // ~9.3 km/h
    } else if (activityType === 'walk') {
      durationMinutes = 30 + Math.floor(Math.random() * 30);  // 30-60 min
      calories        = 120 + Math.floor(Math.random() * 80);
      heartRateAvg    = 95  + Math.floor(Math.random() * 15);
      heartRateMax    = heartRateAvg + 15 + Math.floor(Math.random() * 10);
      distanceM       = Math.floor(durationMinutes * 85 + Math.random() * 300);  // ~5 km/h
    } else {
      // strength
      durationMinutes = 45 + Math.floor(Math.random() * 25);  // 45-70 min
      calories        = 200 + Math.floor(Math.random() * 150);
      heartRateAvg    = 115 + Math.floor(Math.random() * 20);
      heartRateMax    = heartRateAvg + 20 + Math.floor(Math.random() * 15);
    }

    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const value: Record<string, unknown> = {
      activityType,
      durationMinutes,
      calories,
      heartRate: { avg: heartRateAvg, max: heartRateMax },
      startTime: startTime.toISOString(),
      endTime:   endTime.toISOString(),
    };
    if (distanceM !== undefined) value.distanceM = distanceM;

    await prisma.healthDataPoint.upsert({
      where: { googleDataPointId: `seed-exercise-${user.id}-day${i}` },
      update: {},
      create: {
        userId: user.id,
        dataType: 'exercise',
        value,
        recordedAt: startTime,
        source: 'google_health',
        googleDataPointId: `seed-exercise-${user.id}-day${i}`,
      },
    });
  }

  console.log(`✅ Seeded demo user: demo@vitalsync.com / Demo123!`);
}

// =====================================================
// Main
// =====================================================
async function main() {
  console.log('🌱 Seeding database...\n');
  console.log('👤 Seeding demo user with 30 days of data...');
  await seedDemoUser();
  console.log('\n🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
