// Client-side helpers for the Google Health API routes

const token = () => localStorage.getItem('accessToken');
const headers = () => ({ Authorization: `Bearer ${token()}` });
const BASE = '/api/google-health';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkoutSplit {
  km: number;
  paceMinPerKm: number | null;
  durationSeconds: number | null;
}

export interface HeartRateZones {
  lightMins: number;
  moderateMins: number;
  vigorousMins: number;
  peakMins: number;
}

export interface WorkoutSession {
  id: string;
  activityType: 'run' | 'walk' | 'strength';
  recordingMethod?: 'manual' | 'auto';
  displayName?: string | null;
  hasGps?: boolean;

  durationMinutes: number;
  activeDurationMinutes?: number | null;

  calories: number | null;
  heartRate: { avg: number; max: number } | null;
  activeZoneMinutes?: number | null;
  heartRateZones?: HeartRateZones | null;

  distanceM: number | null;
  steps?: number | null;
  avgPaceMinPerKm?: number | null;
  elevationGainM?: number | null;
  splits?: WorkoutSplit[] | null;

  startTime: string | null;
  endTime: string | null;
  recordedAt: string;
}

export interface SleepSession {
  id: string;
  durationMinutes: number;
  stages: { deep: number; rem: number; light: number; awake: number };
  startTime: string | null;
  endTime: string | null;
  quality: number | null;
  recordedAt: string;
}

export interface GoogleHealthStatus {
  connected: boolean;
  account?: { lastSyncAt: string | null };
}

export interface SyncResult {
  exerciseSynced: number;
  sleepSynced: number;
  message: string;
}

// ── API calls ──────────────────────────────────────────────────────────────────

export async function getGoogleHealthStatus(): Promise<GoogleHealthStatus> {
  const res = await fetch(`${BASE}/status`, { headers: headers() });
  if (!res.ok) throw new Error('Failed to fetch Google Health status');
  return res.json();
}

export async function getWorkouts(days = 30): Promise<WorkoutSession[]> {
  const res = await fetch(`${BASE}/workouts?days=${days}`, { headers: headers() });
  if (!res.ok) throw new Error('Failed to fetch workouts');
  const data = await res.json();
  return data.workouts ?? [];
}

export async function getSleep(days = 30): Promise<SleepSession[]> {
  const res = await fetch(`${BASE}/sleep?days=${days}`, { headers: headers() });
  if (!res.ok) throw new Error('Failed to fetch sleep data');
  const data = await res.json();
  return data.sleep ?? [];
}

export async function syncGoogleHealth(days = 30): Promise<SyncResult> {
  const res = await fetch(`${BASE}/sync?days=${days}`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

export async function getGoogleHealthConnectUrl(): Promise<string> {
  const res = await fetch(`${BASE}/connect`, { headers: headers() });
  if (!res.ok) throw new Error('Failed to get connect URL');
  const data = await res.json();
  return data.url;
}

export async function disconnectGoogleHealth(): Promise<void> {
  const res = await fetch(`${BASE}/disconnect`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error('Failed to disconnect');
}
