import { prisma } from '../config/database';

export interface LogFoodInput {
  userId: string;
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  date: string;
  isSavedMeal?: boolean;
}

async function logFood(input: LogFoodInput) {
  // Convert YYYY-MM-DD string to actual Date object starting at midnight UTC
  const parsedDate = new Date(`${input.date}T00:00:00Z`);

  return await prisma.nutritionLog.create({
    data: {
      userId: input.userId,
      foodName: input.foodName,
      calories: input.calories,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      mealType: input.mealType,
      date: parsedDate,
      isSavedMeal: input.isSavedMeal || false,
    }
  });
}

async function getNutritionForDate(userId: string, dateString: string) {
  const parsedDate = new Date(`${dateString}T00:00:00Z`);

  const logs = await prisma.nutritionLog.findMany({
    where: {
      userId,
      date: parsedDate,
    }
  });

  // Calculate daily totals in JavaScript simply by summing
  // This could also be done via raw Prisma aggregate, but summing a few rows is fast enough
  const totals = logs.reduce((acc, log) => ({
    calories: acc.calories + log.calories,
    proteinG: acc.proteinG + Number(log.proteinG),
    carbsG: acc.carbsG + Number(log.carbsG),
    fatG: acc.fatG + Number(log.fatG),
  }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });

  return { logs, totals };
}

async function deleteLog(userId: string, logId: string) {
  // Ensure the log belongs to the user before deleting!
  const log = await prisma.nutritionLog.findUnique({ where: { id: logId } });
  if (!log || log.userId !== userId) {
    throw new Error('Nutrition log not found or unauthorized');
  }

  return await prisma.nutritionLog.delete({
    where: { id: logId }
  });
}

export const nutritionService = {
  logFood,
  getNutritionForDate,
  deleteLog,
};
