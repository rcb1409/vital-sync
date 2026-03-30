import { z } from 'zod';

export const logWorkoutSchema = z.object({
    body: z.object({
        name: z.string().optional(),
        startedAt: z.string().datetime(),
        durationMin: z.number().int().min(1),
        notes: z.string().optional(),
        sets: z.array(z.object({
            exerciseId: z.number().int(),
            setNumber: z.number().int().min(1),
            reps: z.number().int().min(0).max(9999),
            weightKg: z.number().min(0).max(9999),
            rpe: z.number().int().min(1).max(10).optional(),
            isPr: z.boolean().optional(),
        })).min(1, "Workout must have at least one set"),
    })
});