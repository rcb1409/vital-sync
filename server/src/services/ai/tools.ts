import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Tool definitions for the VitalSync coach agent (Anthropic Claude).
 *
 * Each tool's `input_schema` is plain JSON Schema. The model reads `description`
 * to decide when to call the tool, then constructs an `input` object matching
 * the schema. Server-side validation happens in `executor.ts` — these schemas
 * are advisory to the model, not enforced by the API.
 *
 * NOTE: tool execution lives in `executor.ts`.
 */

export const fetchHealthHistoryTool: Tool = {
  name: 'fetchHealthHistory',
  description:
    "Fetches the user's health data from Google Health for a specific date range. Use this when the user asks about past workouts, exercise sessions, sleep history, HRV trends, resting heart rate, VO2 max, or step counts outside of today.",
  input_schema: {
    type: 'object',
    properties: {
      dataType: {
        type: 'string',
        enum: ['exercise', 'sleep', 'hrv', 'resting_hr', 'vo2_max', 'steps', 'all'],
        description: "The type of health data to fetch: 'exercise' for workouts, 'sleep' for sleep sessions, 'hrv' for heart rate variability, 'resting_hr' for resting heart rate, 'vo2_max' for cardio fitness, 'steps' for daily step counts, or 'all' for everything.",
      },
      startDate: {
        type: 'string',
        description: "The start date in YYYY-MM-DD format (e.g., '2026-03-30').",
      },
      endDate: {
        type: 'string',
        description: "The end date in YYYY-MM-DD format (e.g., '2026-04-05').",
      },
    },
    required: ['dataType', 'startDate', 'endDate'],
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

export const fetchNutritionHistoryTool: Tool = {
  name: 'fetchNutritionHistory',
  description:
    "Fetches the user's nutrition logs (food intake) for a date range. Returns daily totals for calories, protein, carbs, and fat. Use this to investigate if poor nutrition might be contributing to recovery issues.",
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

export const getUserGoalsTool: Tool = {
  name: 'getUserGoals',
  description:
    "Fetches the user's fitness goals including calorie targets, protein targets, sleep goals, and activity goals. Use this to compare actual data against the user's personal targets.",
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const coachTools: Tool[] = [
  fetchHealthHistoryTool,
  logFoodTool,
  logWeightTool,
  webSearchTool,
];

export const investigationTools: Tool[] = [
  fetchHealthHistoryTool,
  fetchNutritionHistoryTool,
  getUserGoalsTool,
];
