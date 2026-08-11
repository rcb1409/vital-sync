/**
 * nutritionVision.service.ts
 *
 * Uses Claude via AWS Bedrock to analyse a food photo and return
 * structured macro estimates.  The image is never persisted.
 *
 * Workflow:
 *   1. Receive base64-encoded image from the client
 *   2. Build a multimodal message (image + text prompt)
 *   3. Force a structured response using tool_choice = "tool"
 *   4. Return the parsed items to the caller
 */

import { bedrock } from '@/config/bedrock';
import { env }    from '@/config/env';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FoodItem {
  foodName: string;  // e.g. "2 scrambled eggs"
  calories: number;  // total kcal
  proteinG: number;  // grams
  carbsG:   number;
  fatG:     number;
}

// ── Tool schema ────────────────────────────────────────────────────────────────
// By using tool_choice = { type: "tool", name: "record_food_analysis" } we
// force the model to always call this tool, guaranteeing structured JSON output.

const RECORD_TOOL = {
  name: 'record_food_analysis',
  description:
    'Record the food items identified in the photo together with estimated nutritional values.',
  input_schema: {
    type: 'object' as const,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct food item or dish visible in the photo.',
        items: {
          type: 'object',
          required: ['foodName', 'calories', 'proteinG', 'carbsG', 'fatG'],
          properties: {
            foodName: {
              type: 'string',
              description:
                'Descriptive name including portion size, e.g. "2 scrambled eggs", "1 cup cooked oats".',
            },
            calories: { type: 'number', description: 'Estimated calories (kcal).' },
            proteinG: { type: 'number', description: 'Estimated protein in grams.' },
            carbsG:   { type: 'number', description: 'Estimated carbohydrates in grams.' },
            fatG:     { type: 'number', description: 'Estimated fat in grams.' },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a registered dietitian with expertise in food recognition and nutrition.
Analyse the photo and identify every food item visible.
Estimate calories and macronutrients (protein, carbs, fat) for each item based on standard serving sizes.
Be as specific as possible about portion sizes.
If the photo contains no food, return an empty items array.`;

// ── Main function ──────────────────────────────────────────────────────────────

export async function analyzeFoodPhoto(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg',
): Promise<FoodItem[]> {
  const response = await bedrock.messages.create({
    model:      env.BEDROCK_MODEL_ID,
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    tools:      [RECORD_TOOL],
    tool_choice: { type: 'tool', name: 'record_food_analysis' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          {
            type: 'text',
            text: 'Please analyse this food photo and estimate all macro-nutrients for each item.',
          },
        ],
      },
    ],
  });

  // With tool_choice = "tool" the model MUST call the tool; this is always present.
  const toolBlock = response.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; name: string; id: string; input: unknown }
    | undefined;

  if (!toolBlock) throw new Error('Food analysis returned no structured result.');

  const { items } = toolBlock.input as { items: FoodItem[] };
  return Array.isArray(items) ? items : [];
}
