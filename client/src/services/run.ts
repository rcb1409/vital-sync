import { api } from '../lib/api';

export interface RunActivityLog {
    id: string;
    stravaActivityId?: number;
    distanceM: number;
    movingTimeS: number;
    elevationGainM: number;
    averagePaceSPerKm: number; // Seconds per KM
    startTime: string;
    source: 'strava' | 'manual';
    raw?: any; // The full JSON if they want to build advanced maps later
}

// Fetch unified history from backend
export async function getRunsHistory(): Promise<RunActivityLog[]> {
    const response = await api.get('/runs/history');
    return response.data.history;
}

// Get the OAuth URL for the Connect Button
export async function getStravaAuthUrl(): Promise<string> {
    const response = await api.get('/strava/connect');
    return response.data.url;
}

// Manually command the backend to sync with Strava
export async function triggerStravaSync(): Promise<{ synced: number }> {
    const response = await api.post('/runs/sync');
    return response.data;
}
