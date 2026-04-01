import { z } from 'zod';

// We validate manual run logging just in case a user doesn't have a Strava account
// and wants to input a run manually on the dashboard.
export const logManualRunSchema = z.object({
  body: z.object({
    distanceM: z.number().int().min(1, "Distance must be greater than 0"),
    movingTimeS: z.number().int().min(1, "Moving time must be greater than 0"),
    elevationGainM: z.number().int().optional().default(0),
    startTime: z.string().datetime("Must be a valid ISO Date string"),
  })
});
