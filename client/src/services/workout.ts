// client/src/services/workout.ts
import { api } from '../lib/api';

export interface WorkoutSetPayload {
    exerciseId: number;
    setNumber: number;
    reps: number;
    weightKg: number;
    rpe?: number;
    isPr?: boolean;
}

export interface CompleteWorkoutPayload {
    name?: string;
    startedAt: string;
    durationMin: number;
    notes?: string;
    sets: WorkoutSetPayload[];
}

export async function logCompletedWorkout(payload: CompleteWorkoutPayload) {
    const response = await api.post('/workouts/complete', payload);
    return response.data.workout;
}

export async function getWorkoutsHistory() {
    const response = await api.get('/workouts');
    return response.data.workouts;
}

export async function getWorkoutTemplates() {
    const response = await api.get('/workouts/templates');
    return response.data.templates;
}

export async function getWorkoutTemplate(id: string) {
    const response = await api.get(`/workouts/templates/${id}`);
    return response.data.template;
}
