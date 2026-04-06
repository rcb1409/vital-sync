import { z } from 'zod';
// We explicitly type the goals to ensure no typos or negative values hit our database
export const updateProfileSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    goals: z.object({
        weightKg: z.number().positive().max(300).optional(),
        calories: z.number().int().positive("Calories must be positive").max(10000),
        proteinG: z.number().int().positive().max(500),
        sleepHours: z.number().positive().min(4).max(16),
        waterMl: z.number().int().positive().max(10000)
    }).optional(),
    aiMemory: z.array(z.object({
        category: z.string(),
        fact: z.string()
    })).optional()
});