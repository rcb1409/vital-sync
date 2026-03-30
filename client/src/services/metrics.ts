import { api } from '../lib/api';

// --- Weight Types ---
export interface WeightLog {
    id: string;
    date: string;
    rawWeight: number;
    emaWeight: number; // The smoothed trend line value
}

export interface LogWeightPayload {
    weightKg: number;
    date: string; // YYYY-MM-DD
}

// --- Habit Types ---
export interface DailyHabitsLog {
    id: string;
    date: string;
    sleepHours: number;
    sleepQuality: number; // 1-5
    waterMl: number;
    alcohol: boolean;
    alcoholUnits?: number;
    notes?: string;
}

export interface LogHabitsPayload {
    sleepHours: number;
    sleepQuality: number;
    waterMl: number;
    alcohol: boolean;
    alcoholUnits?: number;
    notes?: string;
    date: string; // YYYY-MM-DD
}

export interface StreaksSummary {
    alcoholFree: number;
    hydration: number;
}

// --- API Calls ---

export async function logWeight(payload: LogWeightPayload): Promise<void> {
    await api.post('/metrics/weight', payload);
}

export async function getWeightHistory(range: '7d' | '30d' | '90d' = '30d'): Promise<WeightLog[]> {
    const response = await api.get(`/metrics/weight?range=${range}`);
    return response.data.history;
}

export async function logHabits(payload: LogHabitsPayload): Promise<void> {
    await api.post('/metrics/habits', payload);
}

export async function getHabitsHistory(range: '7d' | '30d' = '30d'): Promise<DailyHabitsLog[]> {
    const response = await api.get(`/metrics/habits?range=${range}`);
    return response.data.history;
}

export async function getStreaks(): Promise<StreaksSummary> {
    const response = await api.get('/metrics/streaks');
    return response.data.streaks;
}
