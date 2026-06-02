import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Tool definitions for the VitalSync coach agent (Anthropic shape).
 *
 * Each tool's `input_schema` is plain JSON Schema. The model reads `description`
 * to decide when to call the tool, then constructs an `input` object matching
 * the schema. Server-side validation happens in `executor.ts` — these schemas
 * are advisory to the model, not enforced by Bedrock.
 *
 * NOTE: tool execution lives in `executor.ts` and is provider-independent —
 * the same DB-touching code runs whether we call from Gemini, Anthropic, etc.
 */

export const fetchHistoricalWorkoutsTool: Tool = {
  name: 'fetchHistoricalWorkouts',
  description:
    "Fetches the user's past workouts between a specific start and end date. Use this tool ONLY when the user asks about historical workouts outside of today.",
  input_schema: {
    type: 'object',
    properties: {
      startDate: {
        type: 'string',
        description: "The start date in YYYY-MM-DD format (e.g., '2026-03-30').",
      },
      endDate: {
        type: 'string',
        description: "The end date in YYYY-MM-DD format (e.g., '2026-04-05').",
      },
    },
    required: ['startDate', 'endDate'],
  },
};

export const logFoodTool: Tool = {
  name: 'logFood',
  description:
    'Logs a food item to the user\'s daily nutrition tracking. Use this when the user explicitly mentions eating something or asks to log food. Estimate the macros accurately if they don\'t provide them.',
  input_schema: {
    type: 'object',
    properties: {
      foodName: { type: 'string', description: "Name of the food (e.g., '1 Large Banana')" },
      calories: { type: 'number', description: 'Estimated total calories' },
      proteinG: { type: 'number', description: 'Estimated protein in grams' },
      carbsG: { type: 'number', description: 'Estimated carbs in grams' },
      fatG: { type: 'number', description: 'Estimated fat in grams' },
      mealType: {
        type: 'string',
        enum: ['breakfast', 'lunch', 'dinner', 'snack'],
        description: "Must be exactly: 'breakfast', 'lunch', 'dinner', or 'snack'",
      },
    },
    required: ['foodName', 'calories', 'proteinG', 'carbsG', 'fatG', 'mealType'],
  },
};

export const searchExercisesTool: Tool = {
  name: 'searchExercises',
  description:
    'Searches the database for exercises targeting a specific muscle group. Use this to find correct exercise IDs before creating templates or routines.',
  input_schema: {
    type: 'object',
    properties: {
      muscleGroup: {
        type: 'string',
        enum: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'cardio'],
        description: 'Must be exactly one of: chest, back, shoulders, biceps, triceps, legs, core, cardio',
      },
    },
    required: ['muscleGroup'],
  },
};

export const createWorkoutTemplateTool: Tool = {
  name: 'createWorkoutTemplate',
  description:
    'Creates and saves a reusable workout template. Use your fitness knowledge to determine the appropriate sets and reps based on the user\'s goal. In your chat response, briefly explain to the user why you chose these exercises, AND include a Markdown link so they can view the template, exactly like this: [View Template](/workouts/templates/{templateId}) .',
  input_schema: {
    type: 'object',
    properties: {
      templateName: {
        type: 'string',
        description: "Name of the workout template (e.g., 'Back & Arms Hypertrophy')",
      },
      exercises: {
        type: 'array',
        description: 'Array of chosen exercises with their custom sets, reps, and rest periods.',
        items: {
          type: 'object',
          properties: {
            exerciseId: {
              type: 'number',
              description: 'The database ID of the exercise retrieved from searchExercises',
            },
            sets: { type: 'number', description: 'Number of working sets' },
            reps: { type: 'number', description: 'Target reps per set' },
            restSeconds: {
              type: 'number',
              description:
                'Suggested rest time between sets in seconds (e.g., 60-90 for hypertrophy, 120-180 for strength)',
            },
          },
          required: ['exerciseId', 'sets', 'reps', 'restSeconds'],
        },
      },
    },
    required: ['templateName', 'exercises'],
  },
};

export const logWeightTool: Tool = {
  name: 'logWeight',
  description:
    "Logs the user's body weight for today. If the user provides weight in pounds (lbs), you MUST convert it to kilograms (kg) before passing it to this tool (1 lb = 0.453592 kg).",
  input_schema: {
    type: 'object',
    properties: {
      weightKg: {
        type: 'number',
        description: "The user's weight in kilograms (kg). Must be a number.",
      },
    },
    required: ['weightKg'],
  },
};

export const webSearchTool: Tool = {
  name: 'webSearch',
  description:
    'Searches the web for up-to-date information, medical research, or factual data. Use this tool when the user asks about topics outside your internal knowledge or requires current medical/nutritional consensus.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query to look up on the web.' },
    },
    required: ['query'],
  },
};

export const coachTools: Tool[] = [
  fetchHistoricalWorkoutsTool,
  logFoodTool,
  searchExercisesTool,
  createWorkoutTemplateTool,
  logWeightTool,
  webSearchTool,
];
