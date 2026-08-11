import { api } from '../lib/api';

export interface WeightLog {
    id: string;
    date: string;
    rawWeight: number;
    emaWeight: number;
}

export interface LogWeightPayload {
    weightKg: number;
    date: string; // YYYY-MM-DD
}

export async function logWeight(payload: LogWeightPayload): Promise<void> {
    await api.post('/metrics/weight', payload);
}

export async function getWeightHistory(range: '7d' | '30d' | '90d' = '30d'): Promise<WeightLog[]> {
    const response = await api.get(`/metrics/weight?range=${range}`);
    return response.data.history;
}
