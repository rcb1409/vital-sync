import { prisma } from '../config/database';
import { MuscleGroup, Equipment } from '@prisma/client';

interface GetExercisesInput {
    search?: string;
    targetMuscleGroup?: string;
    equipment?: string;
}

async function getExercises(input: GetExercisesInput) {
    // 1. Initialize an empty where clause
    const where: any = {};

    // 2. Add filters dynamically
    if (input.search) {
        where.name = {
            contains: input.search,
        };
    }

    if (input.targetMuscleGroup) {
        where.targetMuscleGroup = input.targetMuscleGroup as MuscleGroup;
    }

    if (input.equipment) {
        where.equipment = input.equipment as Equipment;
    }

    // 3. Query the database
    const exercises = await prisma.exercise.findMany({
        where,
        orderBy: {
            name: 'asc', // Alphabetical order
        },
    });

    return exercises;
}

export const exerciseService = {
    getExercises,
};
