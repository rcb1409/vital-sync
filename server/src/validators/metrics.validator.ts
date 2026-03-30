import { z } from 'zod';

// =======================
// Weight Tracking Schemas
// =======================
export const logWeightSchema = z.object({
  body: z.object({
    weightKg: z.number().min(20).max(500, "Invalid weight range"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  })
});

export const getWeightRangeSchema = z.object({
  query: z.object({
    range: z.enum(['7d', '30d', '90d']).optional().default('30d'),
  })
});

// =======================
// Habit Tracking Schemas
// =======================
export const logHabitsSchema = z.object({
  body: z.object({
    sleepHours: z.number().min(0).max(24),
    sleepQuality: z.number().int().min(1).max(5),
    waterMl: z.number().int().min(0).max(15000),
    alcohol: z.boolean(),
    alcoholUnits: z.number().min(0).optional(),
    notes: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  })
});

export const updateHabitSchema = logHabitsSchema.deepPartial();

export const getHabitsRangeSchema = z.object({
  query: z.object({
    range: z.enum(['7d', '30d']).optional().default('30d'),
  })
});
