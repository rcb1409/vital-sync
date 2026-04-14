import { SchemaType, FunctionDeclaration } from '@google/generative-ai';
import { MuscleGroup } from '@prisma/client';

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

export const searchExercisesDeclaration: FunctionDeclaration = {
  name: "searchExercises",
  description: "Searches the database for exercises targeting a specific muscle group. Use this to find correct exercise IDs before creating templates or routines.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      muscleGroup: {
        type: SchemaType.STRING,
        description: "Must be exactly one of: chest, back, shoulders, biceps, triceps, legs, core, cardio"
      }
    },
    required: ["muscleGroup"]
  }
};

export const createWorkoutTemplateDeclaration: FunctionDeclaration = {
  name: "createWorkoutTemplate",
  description: "Creates and saves a reusable workout template. Use your fitness knowledge to determine the appropriate sets and reps based on the user's goal. In your chat response, briefly explain to the user why you chose these exercises, AND include a Markdown link so they can view the template, exactly like this: [View Template](/workouts/templates/{templateId}) .",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      templateName: { type: SchemaType.STRING, description: "Name of the workout template (e.g., 'Back & Arms Hypertrophy')" },
      exercises: {
        type: SchemaType.ARRAY,
        description: "Array of chosen exercises with their custom sets, reps, and rest periods.",
        items: {
          type: SchemaType.OBJECT,
          properties: {
             exerciseId: { type: SchemaType.NUMBER, description: "The database ID of the exercise retrieved from searchExercises" },
             sets: { type: SchemaType.NUMBER, description: "Number of working sets" },
             reps: { type: SchemaType.NUMBER, description: "Target reps per set" },
             restSeconds: { type: SchemaType.NUMBER, description: "Suggested rest time between sets in seconds (e.g., 60-90 for hypertrophy, 120-180 for strength)" }
          },
          required: ["exerciseId", "sets", "reps", "restSeconds"]
        }
      }
    },
    required: ["templateName", "exercises"]
  }
};

export const coachTools = [
  {
    functionDeclarations: [
      fetchHistoricalWorkoutsDeclaration, 
      logFoodDeclaration, 
      searchExercisesDeclaration,
      createWorkoutTemplateDeclaration
    ]
  }
];
