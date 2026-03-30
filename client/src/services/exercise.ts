import { api } from "../lib/api";

export interface Exercise {
    id: number;
    name: string;
    muscleGroup: string;
    equipment: string | null;
}

export async function searchExercises(query: string): Promise<Exercise[]> {
    const params = query ? { search: query } : {};

    const response = await api.get('/exercises', { params });
    return response.data.exercises
}