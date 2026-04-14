import { prisma } from '../config/database';

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
        isPr?: boolean;
    }[];
}

async function logCompletedWorkout(input: LogWorkoutInput) {
    const workout = await prisma.workout.create({
        data: {
            userId: input.userId,
            name: input.name || 'Workout',
            startedAt: new Date(input.startedAt),
            durationMin: input.durationMin,
            notes: input.notes,
            sets: {
                create: input.sets.map((set) => ({
                    exerciseId: set.exerciseId,
                    setNumber: set.setNumber,
                    reps: set.reps,
                    weightKg: set.weightKg,
                    rpe: set.rpe,
                    isPr: set.isPr || false,
                })),
            },
        },
        include: {
            sets: true,
        }
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

export const workoutService = {
    logCompletedWorkout,
    getUserWorkouts,
    getTemplateWithHistoricalWeights,
};
