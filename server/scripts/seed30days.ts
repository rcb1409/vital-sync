// server/scripts/seed30Days.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting 30-Day Mock Data Seeder...\n');

    // 1. Get the specific test user
    const user = await prisma.user.findUnique({ where: { email: 'test@gmail.com' } });
    if (!user) {
        console.error('❌ User test@gmail.com not found. Please register this account first!');
        process.exit(1);
    }
    console.log(`👤 Seeding data for User: ${user.name} (${user.email})`);

    // 2. Clear old generated data to prevent unique constraint errors
    console.log('🧹 Clearing old mock data...');
    await prisma.bodyMetric.deleteMany({ where: { userId: user.id } });
    await prisma.dailyHabit.deleteMany({ where: { userId: user.id } });
    await prisma.nutritionLog.deleteMany({ where: { userId: user.id } });
    await prisma.workout.deleteMany({ where: { userId: user.id } });

    // 3. We assume at least one exercise exists in the DB (e.g. Bench Press = ID 1)
    const exercise = await prisma.exercise.findFirst();
    const exerciseId = exercise ? exercise.id : 1; // Fallback to 1

    // 4. Generate 30 days of historical data
    const TODAY = new Date();
    let currentWeight = 78.5; // Starting weight

    for (let i = 30; i >= 0; i--) {
        const targetDate = new Date(TODAY);
        targetDate.setDate(targetDate.getDate() - i);
        const dateStr = targetDate.toISOString().split('T')[0];
        const parsedDate = new Date(`${dateStr}T00:00:00Z`);

        console.log(`📅 Generating data for ${dateStr}...`);

        // --- A. BODY METRICS (Weight slowly dropping) ---
        // Random fluctuation between -0.3kg and +0.2kg daily
        currentWeight += (Math.random() * 0.5 - 0.3);
        await prisma.bodyMetric.create({
            data: {
                userId: user.id,
                date: parsedDate,
                weightKg: Number(currentWeight.toFixed(2)),
            }
        });

        // --- B. HABITS (Mostly good, some variance) ---
        const sleptWell = Math.random() > 0.2; // 80% chance of good sleep
        await prisma.dailyHabit.create({
            data: {
                userId: user.id,
                date: parsedDate,
                sleepHours: sleptWell ? (7 + Math.random() * 1.5) : (5 + Math.random() * 1.5),
                sleepQuality: sleptWell ? 4 : 2,
                waterMl: Math.random() > 0.3 ? 2500 : 1500, // 70% chance of hitting hydration goal
                alcohol: Math.random() > 0.8,              // 20% chance of alcohol
                alcoholUnits: Math.random() > 0.8 ? 2 : 0,
            }
        });

        // --- C. NUTRITION (Realistic daily totals broken into meals) ---
        const isGoodDietDay = Math.random() > 0.25; // 75% adherence
        const targetCals = isGoodDietDay ? 2000 : 2800;

        // Breakfast
        await prisma.nutritionLog.create({
            data: {
                userId: user.id, date: parsedDate, mealType: 'breakfast', foodName: 'Oatmeal & Eggs',
                calories: targetCals * 0.25, proteinG: 30, carbsG: 45, fatG: 12
            }
        });
        // Lunch
        await prisma.nutritionLog.create({
            data: {
                userId: user.id, date: parsedDate, mealType: 'lunch', foodName: 'Chicken Salad',
                calories: targetCals * 0.35, proteinG: 50, carbsG: 30, fatG: 15
            }
        });
        // Dinner
        await prisma.nutritionLog.create({
            data: {
                userId: user.id, date: parsedDate, mealType: 'dinner', foodName: isGoodDietDay ? 'Salmon & Rice' : 'Large Pizza',
                calories: targetCals * 0.40, proteinG: isGoodDietDay ? 45 : 20, carbsG: isGoodDietDay ? 50 : 120, fatG: isGoodDietDay ? 20 : 50
            }
        });

        // --- D. WORKOUTS (Workout roughly every other day) ---
        if (Math.random() > 0.4) {
            await prisma.workout.create({
                data: {
                    userId: user.id,
                    name: i % 3 === 0 ? 'Push Day' : i % 2 === 0 ? 'Pull Day' : 'Leg Day',
                    startedAt: targetDate,
                    durationMin: Math.floor(45 + Math.random() * 30),
                    sets: {
                        create: [
                            { exerciseId, setNumber: 1, reps: 10, weightKg: 60, rpe: 7 },
                            { exerciseId, setNumber: 2, reps: 8, weightKg: 65, rpe: 8 },
                            { exerciseId, setNumber: 3, reps: 6, weightKg: 70, rpe: 9, isPr: Math.random() > 0.9 },
                        ]
                    }
                }
            });
        }
    }

    console.log('\n✅ Successfully injected 30 days of data!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
