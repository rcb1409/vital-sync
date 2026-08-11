import { prisma } from '../config/database';
import { cacheService } from './cache.service';

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
  const result = await prisma.bodyMetric.upsert({
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

  // Granular Invalidation: only destroy weight cache and AI context cache
  await cacheService.invalidateSpecific(input.userId, ['weight', 'ctx']);
  return result;
}

async function getWeightHistory(userId: string, rangeDays: number) {
  return cacheService.cacheAside(`metrics:${userId}:weight:${rangeDays}`, 300, async () => {
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
  });
}

export const metricsService = {
  logWeight,
  getWeightHistory,
};
