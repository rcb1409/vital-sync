import { z } from 'zod';

export const logWeightSchema = z.object({
  body: z.object({
    weightKg: z.number().min(20).max(500, 'Invalid weight range'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  })
});

export const getWeightRangeSchema = z.object({
  query: z.object({
    range: z.enum(['7d', '30d', '90d']).optional().default('30d'),
  })
});
