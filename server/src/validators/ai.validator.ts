import { z } from 'zod';

export const AiMemoryFactSchema = z.object({
    fact: z.string(),
    expiresAt: z.string().nullable().optional()
});

export const AiCoachResponseSchema = z.object({
    messageToUser: z.string(),
    aiMemory: z.array(AiMemoryFactSchema).optional().default([])
});
export type AiCoachResponse = z.infer<typeof AiCoachResponseSchema>;

export function validateAiResponse(data: unknown): AiCoachResponse {
    return AiCoachResponseSchema.parse(data)
}