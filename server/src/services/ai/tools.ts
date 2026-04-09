import { SchemaType, FunctionDeclaration } from '@google/generative-ai';

export const fetchHistoricalWorkoutsDeclaration: FunctionDeclaration = {
  name: "fetchHistoricalWorkouts",
  description: "Fetches the user's past workouts between a specific start and end date. Use this tool ONLY when the user asks about historical workouts outside of today.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      startDate: {
        type: SchemaType.STRING,
        description: "The start date in YYYY-MM-DD format (e.g., '2026-03-30')."
      },
      endDate: {
        type: SchemaType.STRING,
        description: "The end date in YYYY-MM-DD format (e.g., '2026-04-05')."
      },
    },
    required: ["startDate", "endDate"]
  }
};

export const logFoodDeclaration: FunctionDeclaration = {
  name: "logFood",
  description: "Logs a food item to the user's daily nutrition tracking. Use this when the user explicitly mentions eating something or asks to log food. Estimate the macros accurately if they don't provide them.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      foodName: { type: SchemaType.STRING, description: "Name of the food (e.g., '1 Large Banana')" },
      calories: { type: SchemaType.NUMBER, description: "Estimated total calories" },
      proteinG: { type: SchemaType.NUMBER, description: "Estimated protein in grams" },
      carbsG: { type: SchemaType.NUMBER, description: "Estimated carbs in grams" },
      fatG: { type: SchemaType.NUMBER, description: "Estimated fat in grams" },
      mealType: { type: SchemaType.STRING, description: "Must be exactly: 'breakfast', 'lunch', 'dinner', or 'snack'" },
    },
    required: ["foodName", "calories", "proteinG", "carbsG", "fatG", "mealType"]
  }
};

export const coachTools = [
  {
    functionDeclarations: [fetchHistoricalWorkoutsDeclaration, logFoodDeclaration]
  }
];
