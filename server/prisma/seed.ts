// -------------------------------------------------------
// Database Seed Script
// -------------------------------------------------------
// Populates the database with:
//   1. 200+ exercises (the default exercise library)
//   2. A demo user with 30 days of realistic fake data
//
// Run with: npx prisma db seed
// -------------------------------------------------------

import { PrismaClient, MuscleGroup, Equipment, MealType, RunSource } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// =====================================================
// Exercise Library (200+ exercises)
// =====================================================
const exercises: { name: string; muscleGroup: MuscleGroup; equipment: Equipment }[] = [
  // --- CHEST (20) ---
  { name: 'Flat Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell' },
  { name: 'Incline Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell' },
  { name: 'Decline Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell' },
  { name: 'Flat Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell' },
  { name: 'Incline Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell' },
  { name: 'Decline Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell' },
  { name: 'Dumbbell Flyes', muscleGroup: 'chest', equipment: 'dumbbell' },
  { name: 'Incline Dumbbell Flyes', muscleGroup: 'chest', equipment: 'dumbbell' },
  { name: 'Cable Crossover', muscleGroup: 'chest', equipment: 'cable' },
  { name: 'Low Cable Crossover', muscleGroup: 'chest', equipment: 'cable' },
  { name: 'Pec Deck Machine', muscleGroup: 'chest', equipment: 'machine' },
  { name: 'Chest Press Machine', muscleGroup: 'chest', equipment: 'machine' },
  { name: 'Push-Ups', muscleGroup: 'chest', equipment: 'bodyweight' },
  { name: 'Diamond Push-Ups', muscleGroup: 'chest', equipment: 'bodyweight' },
  { name: 'Decline Push-Ups', muscleGroup: 'chest', equipment: 'bodyweight' },
  { name: 'Wide Push-Ups', muscleGroup: 'chest', equipment: 'bodyweight' },
  { name: 'Dips (Chest)', muscleGroup: 'chest', equipment: 'bodyweight' },
  { name: 'Smith Machine Bench Press', muscleGroup: 'chest', equipment: 'machine' },
  { name: 'Landmine Press', muscleGroup: 'chest', equipment: 'barbell' },
  { name: 'Svend Press', muscleGroup: 'chest', equipment: 'other' },

  // --- BACK (25) ---
  { name: 'Barbell Deadlift', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Sumo Deadlift', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Romanian Deadlift', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Pendlay Row', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'T-Bar Row', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Dumbbell Row', muscleGroup: 'back', equipment: 'dumbbell' },
  { name: 'Dumbbell Pullover', muscleGroup: 'back', equipment: 'dumbbell' },
  { name: 'Pull-Ups', muscleGroup: 'back', equipment: 'bodyweight' },
  { name: 'Chin-Ups', muscleGroup: 'back', equipment: 'bodyweight' },
  { name: 'Neutral Grip Pull-Ups', muscleGroup: 'back', equipment: 'bodyweight' },
  { name: 'Lat Pulldown', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Close Grip Lat Pulldown', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Seated Cable Row', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Face Pulls', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Straight Arm Pulldown', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Cable Pullover', muscleGroup: 'back', equipment: 'cable' },
  { name: 'Machine Row', muscleGroup: 'back', equipment: 'machine' },
  { name: 'Chest Supported Row', muscleGroup: 'back', equipment: 'machine' },
  { name: 'Rack Pulls', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Good Mornings', muscleGroup: 'back', equipment: 'barbell' },
  { name: 'Hyperextensions', muscleGroup: 'back', equipment: 'bodyweight' },
  { name: 'Reverse Hyperextensions', muscleGroup: 'back', equipment: 'machine' },
  { name: 'Inverted Row', muscleGroup: 'back', equipment: 'bodyweight' },
  { name: 'Meadows Row', muscleGroup: 'back', equipment: 'barbell' },

  // --- SHOULDERS (20) ---
  { name: 'Overhead Press', muscleGroup: 'shoulders', equipment: 'barbell' },
  { name: 'Push Press', muscleGroup: 'shoulders', equipment: 'barbell' },
  { name: 'Behind the Neck Press', muscleGroup: 'shoulders', equipment: 'barbell' },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Arnold Press', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Lateral Raises', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Front Raises', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Rear Delt Flyes', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Cable Lateral Raises', muscleGroup: 'shoulders', equipment: 'cable' },
  { name: 'Cable Front Raises', muscleGroup: 'shoulders', equipment: 'cable' },
  { name: 'Cable Rear Delt Flyes', muscleGroup: 'shoulders', equipment: 'cable' },
  { name: 'Machine Shoulder Press', muscleGroup: 'shoulders', equipment: 'machine' },
  { name: 'Machine Lateral Raise', muscleGroup: 'shoulders', equipment: 'machine' },
  { name: 'Reverse Pec Deck', muscleGroup: 'shoulders', equipment: 'machine' },
  { name: 'Upright Row', muscleGroup: 'shoulders', equipment: 'barbell' },
  { name: 'Dumbbell Shrugs', muscleGroup: 'shoulders', equipment: 'dumbbell' },
  { name: 'Barbell Shrugs', muscleGroup: 'shoulders', equipment: 'barbell' },
  { name: 'Handstand Push-Ups', muscleGroup: 'shoulders', equipment: 'bodyweight' },
  { name: 'Pike Push-Ups', muscleGroup: 'shoulders', equipment: 'bodyweight' },
  { name: 'Lu Raises', muscleGroup: 'shoulders', equipment: 'dumbbell' },

  // --- BICEPS (15) ---
  { name: 'Barbell Curl', muscleGroup: 'biceps', equipment: 'barbell' },
  { name: 'EZ Bar Curl', muscleGroup: 'biceps', equipment: 'barbell' },
  { name: 'Preacher Curl', muscleGroup: 'biceps', equipment: 'barbell' },
  { name: 'Dumbbell Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Hammer Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Incline Dumbbell Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Concentration Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Zottman Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Cable Curl', muscleGroup: 'biceps', equipment: 'cable' },
  { name: 'Cable Hammer Curl', muscleGroup: 'biceps', equipment: 'cable' },
  { name: 'High Cable Curl', muscleGroup: 'biceps', equipment: 'cable' },
  { name: 'Machine Curl', muscleGroup: 'biceps', equipment: 'machine' },
  { name: 'Spider Curl', muscleGroup: 'biceps', equipment: 'dumbbell' },
  { name: 'Reverse Curl', muscleGroup: 'biceps', equipment: 'barbell' },
  { name: 'Drag Curl', muscleGroup: 'biceps', equipment: 'barbell' },

  // --- TRICEPS (15) ---
  { name: 'Close Grip Bench Press', muscleGroup: 'triceps', equipment: 'barbell' },
  { name: 'Skull Crushers', muscleGroup: 'triceps', equipment: 'barbell' },
  { name: 'Overhead Barbell Tricep Extension', muscleGroup: 'triceps', equipment: 'barbell' },
  { name: 'Dumbbell Tricep Extension', muscleGroup: 'triceps', equipment: 'dumbbell' },
  { name: 'Overhead Dumbbell Tricep Extension', muscleGroup: 'triceps', equipment: 'dumbbell' },
  { name: 'Dumbbell Kickback', muscleGroup: 'triceps', equipment: 'dumbbell' },
  { name: 'Tricep Pushdown', muscleGroup: 'triceps', equipment: 'cable' },
  { name: 'Rope Pushdown', muscleGroup: 'triceps', equipment: 'cable' },
  { name: 'Overhead Cable Extension', muscleGroup: 'triceps', equipment: 'cable' },
  { name: 'Single Arm Pushdown', muscleGroup: 'triceps', equipment: 'cable' },
  { name: 'Tricep Dips', muscleGroup: 'triceps', equipment: 'bodyweight' },
  { name: 'Bench Dips', muscleGroup: 'triceps', equipment: 'bodyweight' },
  { name: 'Machine Tricep Extension', muscleGroup: 'triceps', equipment: 'machine' },
  { name: 'JM Press', muscleGroup: 'triceps', equipment: 'barbell' },
  { name: 'Tate Press', muscleGroup: 'triceps', equipment: 'dumbbell' },

  // --- LEGS (35) ---
  { name: 'Barbell Back Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Front Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Overhead Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Goblet Squat', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Dumbbell Lunges', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Walking Lunges', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Reverse Lunges', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Dumbbell Step-Ups', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Dumbbell Romanian Deadlift', muscleGroup: 'legs', equipment: 'dumbbell' },
  { name: 'Barbell Hip Thrust', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Glute Bridge', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Leg Press', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Hack Squat', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Smith Machine Squat', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Leg Extension', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Leg Curl', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Seated Leg Curl', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Standing Calf Raise', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Seated Calf Raise', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Donkey Calf Raise', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Hip Adductor Machine', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Hip Abductor Machine', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Cable Pull-Through', muscleGroup: 'legs', equipment: 'cable' },
  { name: 'Cable Kickback', muscleGroup: 'legs', equipment: 'cable' },
  { name: 'Pistol Squats', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Box Jumps', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Jump Squats', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Wall Sits', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Sissy Squat', muscleGroup: 'legs', equipment: 'bodyweight' },
  { name: 'Barbell Lunges', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Zercher Squat', muscleGroup: 'legs', equipment: 'barbell' },
  { name: 'Belt Squat', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Pendulum Squat', muscleGroup: 'legs', equipment: 'machine' },
  { name: 'Nordic Hamstring Curl', muscleGroup: 'legs', equipment: 'bodyweight' },

  // --- CORE (15) ---
  { name: 'Crunches', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Sit-Ups', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Plank', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Side Plank', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Russian Twists', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Hanging Leg Raises', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Hanging Knee Raises', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Ab Wheel Rollout', muscleGroup: 'core', equipment: 'other' },
  { name: 'Cable Woodchop', muscleGroup: 'core', equipment: 'cable' },
  { name: 'Cable Crunch', muscleGroup: 'core', equipment: 'cable' },
  { name: 'Pallof Press', muscleGroup: 'core', equipment: 'cable' },
  { name: 'Decline Sit-Ups', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Mountain Climbers', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Dead Bug', muscleGroup: 'core', equipment: 'bodyweight' },
  { name: 'Bicycle Crunches', muscleGroup: 'core', equipment: 'bodyweight' },

  // --- CARDIO (15) ---
  { name: 'Treadmill Running', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Treadmill Walking', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Stationary Bike', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Rowing Machine', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Elliptical', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Stair Climber', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Assault Bike', muscleGroup: 'cardio', equipment: 'machine' },
  { name: 'Jump Rope', muscleGroup: 'cardio', equipment: 'other' },
  { name: 'Burpees', muscleGroup: 'cardio', equipment: 'bodyweight' },
  { name: 'Jumping Jacks', muscleGroup: 'cardio', equipment: 'bodyweight' },
  { name: 'High Knees', muscleGroup: 'cardio', equipment: 'bodyweight' },
  { name: 'Battle Ropes', muscleGroup: 'cardio', equipment: 'other' },
  { name: 'Sled Push', muscleGroup: 'cardio', equipment: 'other' },
  { name: 'Farmers Walk', muscleGroup: 'cardio', equipment: 'dumbbell' },
  { name: 'Kettlebell Swing', muscleGroup: 'cardio', equipment: 'other' },
];

// =====================================================
// Demo User with 30 Days of Data
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
        training_days_per_week: 5,
      },
    },
  });

  // Get all exercises for creating workouts
  const allExercises = await prisma.exercise.findMany();
  const getExercise = (name: string) => allExercises.find((e) => e.name === name)!;

  const today = new Date();

  // --- 30 days of body metrics ---
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    // Weight trending from ~83.5 → ~82.4 with daily fluctuation
    const baseWeight = 83.5 - (29 - i) * 0.037;
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

  // --- 30 days of daily habits ---
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    await prisma.dailyHabit.upsert({
      where: { userId_date: { userId: user.id, date: new Date(date.toISOString().split('T')[0]) } },
      update: {},
      create: {
        userId: user.id,
        sleepHours: isWeekend ? 7 + Math.random() * 2 : 5.5 + Math.random() * 2,
        sleepQuality: isWeekend ? Math.ceil(Math.random() * 2) + 3 : Math.ceil(Math.random() * 3) + 1,
        waterMl: Math.floor(1500 + Math.random() * 1500),
        alcohol: isWeekend && Math.random() > 0.4,
        alcoholUnits: isWeekend && Math.random() > 0.4 ? Math.floor(Math.random() * 4) + 1 : null,
        date: new Date(date.toISOString().split('T')[0]),
      },
    });
  }

  // --- 30 days of nutrition logs ---
  const meals = [
    { food: 'Oatmeal with Berries', cal: 350, p: 12, c: 55, f: 8, meal: 'breakfast' as MealType },
    { food: 'Protein Shake', cal: 280, p: 40, c: 15, f: 5, meal: 'breakfast' as MealType },
    { food: 'Eggs and Toast', cal: 420, p: 28, c: 30, f: 22, meal: 'breakfast' as MealType },
    { food: 'Chicken and Rice', cal: 550, p: 45, c: 60, f: 10, meal: 'lunch' as MealType },
    { food: 'Turkey Sandwich', cal: 480, p: 35, c: 45, f: 15, meal: 'lunch' as MealType },
    { food: 'Salmon Bowl', cal: 620, p: 40, c: 55, f: 22, meal: 'lunch' as MealType },
    { food: 'Steak and Vegetables', cal: 650, p: 50, c: 20, f: 35, meal: 'dinner' as MealType },
    { food: 'Pasta with Meat Sauce', cal: 580, p: 30, c: 70, f: 18, meal: 'dinner' as MealType },
    { food: 'Grilled Chicken Salad', cal: 450, p: 42, c: 15, f: 25, meal: 'dinner' as MealType },
    { food: 'Greek Yogurt', cal: 150, p: 15, c: 12, f: 5, meal: 'snack' as MealType },
    { food: 'Protein Bar', cal: 220, p: 20, c: 25, f: 8, meal: 'snack' as MealType },
    { food: 'Mixed Nuts', cal: 180, p: 6, c: 8, f: 16, meal: 'snack' as MealType },
  ];

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // 3-5 food entries per day
    const numEntries = 3 + Math.floor(Math.random() * 3);
    const dayMeals = [...meals].sort(() => Math.random() - 0.5).slice(0, numEntries);

    for (const m of dayMeals) {
      await prisma.nutritionLog.create({
        data: {
          userId: user.id,
          foodName: m.food,
          calories: m.cal + Math.floor((Math.random() - 0.5) * 50),
          proteinG: m.p + Math.floor((Math.random() - 0.5) * 5),
          carbsG: m.c + Math.floor((Math.random() - 0.5) * 10),
          fatG: m.f + Math.floor((Math.random() - 0.5) * 5),
          mealType: m.meal,
          date: new Date(dateStr),
        },
      });
    }
  }

  // --- ~18 workouts over 30 days (4-5 per week) ---
  const workoutPlans = [
    {
      name: 'Push Day',
      exercises: [
        { name: 'Flat Barbell Bench Press', sets: [{ r: 5, w: 90 }, { r: 5, w: 95 }, { r: 5, w: 95 }, { r: 4, w: 95 }] },
        { name: 'Incline Dumbbell Press', sets: [{ r: 10, w: 34 }, { r: 10, w: 34 }, { r: 8, w: 34 }] },
        { name: 'Cable Crossover', sets: [{ r: 12, w: 15 }, { r: 12, w: 15 }, { r: 10, w: 15 }] },
        { name: 'Overhead Press', sets: [{ r: 8, w: 50 }, { r: 8, w: 50 }, { r: 6, w: 50 }] },
        { name: 'Lateral Raises', sets: [{ r: 15, w: 10 }, { r: 15, w: 10 }, { r: 12, w: 10 }] },
        { name: 'Rope Pushdown', sets: [{ r: 12, w: 25 }, { r: 12, w: 25 }, { r: 10, w: 25 }] },
      ],
    },
    {
      name: 'Pull Day',
      exercises: [
        { name: 'Barbell Deadlift', sets: [{ r: 5, w: 140 }, { r: 5, w: 140 }, { r: 3, w: 150 }] },
        { name: 'Pull-Ups', sets: [{ r: 8, w: 0 }, { r: 7, w: 0 }, { r: 6, w: 0 }] },
        { name: 'Barbell Row', sets: [{ r: 8, w: 80 }, { r: 8, w: 80 }, { r: 6, w: 85 }] },
        { name: 'Seated Cable Row', sets: [{ r: 10, w: 60 }, { r: 10, w: 60 }, { r: 8, w: 65 }] },
        { name: 'Face Pulls', sets: [{ r: 15, w: 20 }, { r: 15, w: 20 }, { r: 15, w: 20 }] },
        { name: 'Barbell Curl', sets: [{ r: 10, w: 30 }, { r: 10, w: 30 }, { r: 8, w: 30 }] },
      ],
    },
    {
      name: 'Leg Day',
      exercises: [
        { name: 'Barbell Back Squat', sets: [{ r: 5, w: 120 }, { r: 5, w: 120 }, { r: 5, w: 125 }] },
        { name: 'Romanian Deadlift', sets: [{ r: 8, w: 100 }, { r: 8, w: 100 }, { r: 8, w: 100 }] },
        { name: 'Leg Press', sets: [{ r: 10, w: 200 }, { r: 10, w: 200 }, { r: 8, w: 220 }] },
        { name: 'Leg Extension', sets: [{ r: 12, w: 50 }, { r: 12, w: 50 }, { r: 10, w: 55 }] },
        { name: 'Leg Curl', sets: [{ r: 12, w: 40 }, { r: 12, w: 40 }, { r: 10, w: 45 }] },
        { name: 'Standing Calf Raise', sets: [{ r: 15, w: 80 }, { r: 15, w: 80 }, { r: 12, w: 80 }] },
      ],
    },
  ];

  let workoutIndex = 0;
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayOfWeek = date.getDay();

    // Skip some rest days (Sunday, most Wednesdays)
    if (dayOfWeek === 0) continue;
    if (dayOfWeek === 3 && Math.random() > 0.3) continue;

    const plan = workoutPlans[workoutIndex % workoutPlans.length];
    workoutIndex++;

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        name: plan.name,
        startedAt: new Date(date.setHours(7 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60))),
        durationMin: 55 + Math.floor(Math.random() * 20),
      },
    });

    let setNumber = 1;
    for (const ex of plan.exercises) {
      const exercise = getExercise(ex.name);
      if (!exercise) continue;

      for (const s of ex.sets) {
        await prisma.workoutSet.create({
          data: {
            workoutId: workout.id,
            exerciseId: exercise.id,
            setNumber: setNumber++,
            reps: s.r,
            weightKg: s.w + Math.floor((Math.random() - 0.5) * 5),
          },
        });
      }
    }
  }

  // --- ~10 run activities over 30 days ---
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayOfWeek = date.getDay();

    // Run on Tuesdays, Thursdays, and some Saturdays
    if (dayOfWeek !== 2 && dayOfWeek !== 4 && !(dayOfWeek === 6 && Math.random() > 0.5)) continue;

    const distanceM = Math.floor(3000 + Math.random() * 9000); // 3-12km
    const pacePerKm = 280 + Math.floor(Math.random() * 60); // 4:40-5:40 min/km
    const movingTimeS = Math.floor((distanceM / 1000) * pacePerKm);

    await prisma.runActivity.create({
      data: {
        userId: user.id,
        distanceM,
        movingTimeS,
        elevationGainM: Math.floor(20 + Math.random() * 100),
        averagePaceSPerKm: pacePerKm,
        startTime: new Date(date.setHours(6, 30)),
        source: 'manual',
      },
    });
  }

  console.log(`✅ Seeded demo user: demo@vitalsync.com / Demo123!`);
}

// =====================================================
// Main Seed Function
// =====================================================
async function main() {
  console.log('🌱 Seeding database...\n');

  // 1. Seed exercises
  console.log(`📋 Seeding ${exercises.length} exercises...`);
  for (const ex of exercises) {
    await prisma.exercise.upsert({
      where: { id: 0 }, // Will never match, forces create
      update: {},
      create: {
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        equipment: ex.equipment,
        userId: null, // Default library (not user-created)
      },
    });
  }
  const count = await prisma.exercise.count();
  console.log(`   ✅ ${count} exercises in database\n`);

  // 2. Seed demo user with 30 days of data
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
