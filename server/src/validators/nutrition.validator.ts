import { z } from 'zod';

export const mealTypeEnum = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

// Base constraints for numeric macros
const macroConstraint = z.number().min(0, "Macro cannot be negative");

export const logNutritionSchema = z.object({
  body: z.object({
    foodName: z.string().min(1, "Food name is required"),
    calories: z.number().int().min(0, "Calories must be positive"),
    proteinG: macroConstraint,
    carbsG: macroConstraint,
    fatG: macroConstraint,
    mealType: mealTypeEnum,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    isSavedMeal: z.boolean().optional(),
  })
});

export const getNutritionByDateSchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  })
});

export const getNutritionSummarySchema = z.object({
  query: z.object({
    rangeDays: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().min(1).max(90)).optional().default("7")
  })
});
