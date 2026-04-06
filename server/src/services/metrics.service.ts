import { prisma } from '../config/database';

// ----------------------------------------------------------------------
// WEIGHT & TRENDS
// ----------------------------------------------------------------------

export interface LogWeightInput {
  userId: string;
  weightKg: number;
  date: string;
}

async function logWeight(input: LogWeightInput) {
  const parsedDate = new Date(`${input.date}T00:00:00Z`);

  // upsert because there can only be one weight entry per day per user
  return await prisma.bodyMetric.upsert({
    where: {
      userId_date: {
        userId: input.userId,
        date: parsedDate,
      }
    },
    update: { weightKg: input.weightKg },
    create: {
      userId: input.userId,
      weightKg: input.weightKg,
      date: parsedDate,
    }
  });
}

async function getWeightHistory(userId: string, rangeDays: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rangeDays);

  const entries = await prisma.bodyMetric.findMany({
    where: {
      userId,
      date: { gte: cutoffDate }
    },
    orderBy: { date: 'asc' }
  });

  // Calculate generic Exponential Moving Average (EMA) to smooth out daily fluctuations
  let currentEma = entries.length > 0 ? Number(entries[0].weightKg) : null;
  const smoothingFactor = 2 / (7 + 1); // 7-day EMA

  const trendedData = entries.map(entry => {
    const rawWeight = Number(entry.weightKg);
    if (currentEma === null) {
      currentEma = rawWeight;
    } else {
      currentEma = (rawWeight - currentEma) * smoothingFactor + currentEma;
    }
    
    return {
      id: entry.id,
      date: entry.date,
      rawWeight,
      emaWeight: Number(currentEma.toFixed(2))
    };
  });

  return trendedData;
}

// ----------------------------------------------------------------------
// DAILY HABITS
// ----------------------------------------------------------------------

export interface LogHabitsInput {
  userId: string;
  sleepHours: number;
  sleepQuality: number;
  waterMl: number;
  alcohol: boolean;
  alcoholUnits?: number;
  notes?: string;
  date: string;
}

async function logHabits(input: LogHabitsInput) {
  const parsedDate = new Date(`${input.date}T00:00:00Z`);

  return await prisma.dailyHabit.upsert({
    where: {
      userId_date: {
        userId: input.userId,
        date: parsedDate,
      }
    },
    update: {
      sleepHours: input.sleepHours,
      sleepQuality: input.sleepQuality,
      waterMl: input.waterMl,
      alcohol: input.alcohol,
      alcoholUnits: input.alcoholUnits,
      notes: input.notes,
    },
    create: {
      userId: input.userId,
      sleepHours: input.sleepHours,
      sleepQuality: input.sleepQuality,
      waterMl: input.waterMl,
      alcohol: input.alcohol,
      alcoholUnits: input.alcoholUnits,
      notes: input.notes,
      date: parsedDate,
    }
  });
}

async function getHabitForDate(userId: string, dateString: string) {
  const parsedDate = new Date(`${dateString}T00:00:00Z`);
  return await prisma.dailyHabit.findUnique({
    where: {
      userId_date: { userId, date: parsedDate }
    }
  });
}

async function getHabitsHistory(userId: string, rangeDays: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rangeDays);

  return await prisma.dailyHabit.findMany({
    where: {
      userId,
      date: { gte: cutoffDate }
    },
    orderBy: { date: 'desc' }
  });
}

async function getStreaks(userId: string) {
  // Pull last 30 days to calculate consecutive streaks
  const history = await getHabitsHistory(userId, 30);
  
  let alcoholFreeStreak = 0;
  let hydrationStreak = 0; // Days hitting 2000ml+

  for (const day of history) {
    // Break if the streak is broken
    if (!day.alcohol) {
      alcoholFreeStreak++;
    } else {
      // we only care about the current unbroken streak
      // assuming history is sorted desc
      break;
    }
  }

  for (const day of history) {
    if (day.waterMl >= 2000) {
      hydrationStreak++;
    } else {
      break;
    }
  }

  return {
    alcoholFree: alcoholFreeStreak,
    hydration: hydrationStreak
  };
}

export const metricsService = {
  logWeight,
  getWeightHistory,
  logHabits,
  getHabitForDate,
  getHabitsHistory,
  getStreaks
};
