// -------------------------------------------------------
// Auth Validation Schemas (Zod)
// -------------------------------------------------------
// These schemas validate request bodies for auth endpoints.
// Zod gives us runtime type checking + automatic TypeScript
// types from the same source of truth.
// -------------------------------------------------------

import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  goals: z
    .object({
      calorie_target: z.number().int().positive().optional(),
      protein_target: z.number().int().positive().optional(),
      target_weight: z.number().positive().optional(),
      training_days_per_week: z.number().int().min(1).max(7).optional(),
    })
    .optional(),
});

// TypeScript types derived from schemas
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
