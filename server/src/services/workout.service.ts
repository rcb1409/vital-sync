import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

interface LogWorkoutInput {
    userId: string;
    name?: string;
    startedAt: string;
    durationMin: number;
    notes?: string;
    sets: {
        exerciseId: number;
        setNumber: number;
        reps: number;
        weightKg: number;
        rpe?: number;
    }[];
}

/**
 * PR Detection Algorithm
 * For a given exercise and rep count, check if the weight exceeds the
 * historical max weight at the same or fewer reps.
 * 
 * Logic: A set is a PR if weightKg > MAX(weight_kg) FROM workout_sets
 *        WHERE exercise_id = X AND reps <= Y (same user's workouts only)
 * 
 * This means benching 100kg x 5 is a PR even if you've done 100kg x 3 before,
 * because you've never done that weight at 5 reps.
 */
async function detectPR(
    userId: string,
    exerciseId: number,
    reps: number,
    weightKg: number,
    tx: Prisma.TransactionClient
): Promise<boolean> {
    // Skip PR detection for bodyweight exercises (weight = 0)
    if (weightKg <= 0) return false;

    // Query the historical max weight for this exercise at the same or fewer reps
    // We join through workouts to scope by userId
    const result = await tx.workoutSet.findFirst({
        where: {
            exerciseId,
            reps: { lte: reps },
            workout: { userId },
        },
        orderBy: { weightKg: 'desc' },
        select: { weightKg: true },
    });

    if (!result) {
        // First time logging this exercise — it's a PR by definition
        return true;
    }

    return weightKg > Number(result.weightKg);
}

async function logCompletedWorkout(input: LogWorkoutInput) {
    // Use a transaction so workout + sets + PR flags are all atomic
    const workout = await prisma.$transaction(async (tx) => {
        // 1. Create the workout shell first
        const newWorkout = await tx.workout.create({
            data: {
                userId: input.userId,
                name: input.name || 'Workout',
                startedAt: new Date(input.startedAt),
                durationMin: input.durationMin,
                notes: input.notes,
            },
        });

        // 2. Detect PRs and create sets
        const createdSets = await Promise.all(
            input.sets.map(async (set) => {
                const isPr = await detectPR(
                    input.userId,
                    set.exerciseId,
                    set.reps,
                    set.weightKg,
                    tx
                );

                return tx.workoutSet.create({
                    data: {
                        workoutId: newWorkout.id,
                        exerciseId: set.exerciseId,
                        setNumber: set.setNumber,
                        reps: set.reps,
                        weightKg: set.weightKg,
                        rpe: set.rpe,
                        isPr,
                    },
                });
            })
        );

        return { ...newWorkout, sets: createdSets };
    });

    return workout;
}

async function getUserWorkouts(userId: string) {
    return await prisma.workout.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        include: {
            sets: {
                include: {
                    exercise: true
                }
            }
        }
    });
}

/**
 * Get workouts filtered by date range (used by AI tool).
 * Replaces the old pattern of loading all workouts + JS filter.
 */
async function getUserWorkoutsByDateRange(userId: string, startDate: string, endDate: string) {
    return await prisma.workout.findMany({
        where: {
            userId,
            startedAt: {
                gte: new Date(`${startDate}T00:00:00Z`),
                lte: new Date(`${endDate}T23:59:59Z`),
            },
        },
        orderBy: { startedAt: 'desc' },
        include: {
            sets: {
                include: {
                    exercise: true
                }
            }
        }
    });
}

async function getTemplateWithHistoricalWeights(userId: string, templateId: string) {
    const template = await prisma.workoutTemplate.findUnique({
        where: { id: templateId, userId }
    });

    if (!template) {
        throw new Error('Template not found');
    }

    const exercises = template.exercises as any[];

    // Auto-populate historical weights live
    const populatedExercises = await Promise.all(exercises.map(async (ex) => {
        const lastWorkoutSet = await prisma.workoutSet.findFirst({
            where: { exerciseId: ex.exercise_id, workout: { userId } },
            orderBy: { workout: { startedAt: 'desc' } },
            select: { workoutId: true }
        });

        let historicalWeights: number[] = [];
        if (lastWorkoutSet) {
            const sets = await prisma.workoutSet.findMany({
                where: { workoutId: lastWorkoutSet.workoutId, exerciseId: ex.exercise_id },
                orderBy: { setNumber: 'asc' }
            });
            historicalWeights = sets.map(s => Number(s.weightKg));
        }

        const exerciseDetails = await prisma.exercise.findUnique({
            where: { id: ex.exercise_id },
            select: { name: true }
        });

        // Map sets to historical data
        const mappedSets = [];
        for (let i = 0; i < ex.sets; i++) {
            let weight = 0;
            if (i < historicalWeights.length) {
                weight = historicalWeights[i];
            } else if (historicalWeights.length > 0) {
                weight = historicalWeights[historicalWeights.length - 1];
            }
            
            mappedSets.push({
                setNumber: i + 1,
                reps: ex.reps,
                weightKg: weight,
            });
        }

        return {
            exerciseId: ex.exercise_id,
            exerciseName: exerciseDetails?.name || 'Unknown',
            sets: mappedSets,
            restSeconds: ex.rest_seconds || 120
        };
    }));

    return {
        id: template.id,
        name: template.name,
        exercises: populatedExercises
    };
}

async function getUserTemplates(userId: string) {
    return await prisma.workoutTemplate.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
    });
}

export const workoutService = {
    logCompletedWorkout,
    getUserWorkouts,
    getUserWorkoutsByDateRange,
    getTemplateWithHistoricalWeights,
    getUserTemplates,
    detectPR,
};
