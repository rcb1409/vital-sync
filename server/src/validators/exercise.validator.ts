import { z } from "zod";

export const getExerciseSchema = z.object({
    query: z.object({
        search: z.string().optional(),
        targetMuscleGroup: z.string().optional(),
        equipment: z.string().optional(),
    })
})

