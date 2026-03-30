import { api } from '../lib/api';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface NutritionLog {
    id: string;
    foodName: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealType: MealType;
    isSavedMeal: boolean;
    date: string;
}

export interface DayNutritionSummary {
    logs: NutritionLog[];
    totals: {
        calories: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
    };
}

export interface LogFoodPayload {
    foodName: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealType: MealType;
    date: string; // YYYY-MM-DD
    isSavedMeal?: boolean;
}

export async function logFood(payload: LogFoodPayload): Promise<NutritionLog> {
    const response = await api.post('/nutrition', payload);
    return response.data.log;
}

export async function getNutritionForDate(dateStr: string): Promise<DayNutritionSummary> {
    const response = await api.get(`/nutrition?date=${dateStr}`);
    return response.data;
}

export async function deleteFoodLog(logId: string): Promise<void> {
    await api.delete(`/nutrition/${logId}`);
}
