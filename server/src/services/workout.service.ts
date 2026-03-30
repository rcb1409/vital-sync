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

export const workoutService = {
    logCompletedWorkout,
    getUserWorkouts,
};
