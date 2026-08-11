// -------------------------------------------------------
// Google Health Service
// -------------------------------------------------------
// Handles all interactions with the Google Health API:
//   OAuth:        getAuthUrl, exchangeCodeForTokens
//   Tokens:       getValidAccessToken
//   Write:        writeExerciseSession (one call after workout completes)
//   Read (fetch): fetchActivityData, fetchSleepData
//                 fetchHeartRateData, fetchCaloriesData, fetchWorkoutVitals
//   Utilities:    getConnectionStatus, disconnectAccount
//
// API base: https://health.googleapis.com/v4/
// Mirrors the same pattern as run.service.ts (Strava)
// -------------------------------------------------------

import axios from 'axios';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { healthSummaryService } from './healthSummary.service';

// ── Constants ────────────────────────────────────────────────────────────────

// The health scopes registered in Google Cloud Console → OAuth consent screen → Scopes.
// + openid so Google returns an id_token (needed to read the user's Google account ID)
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
].join(' ');

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_HEALTH_BASE = 'https://health.googleapis.com/v4';

// Must exactly match what you entered in Google Cloud Console → Credentials
const REDIRECT_URI = `http://localhost:4000/api/google-health/callback`;

// ── Runner 1: OAuth Flow ─────────────────────────────────────────────────────

/**
 * Build the Google consent URL to redirect the user to.
 * We pass userId as the `state` param — Google echoes it back in the callback,
 * so we know which VitalSync user just authorized their Google account.
 * (Same pattern as strava.routes.ts)
 */
function getAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID!,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // required to receive a refresh_token
    prompt:        'consent',   // forces Google to always return a refresh_token (even on reconnect)
    state:         userId,      // passed back unchanged in the callback
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange the one-time authorization code for an access token + refresh token.
 * Called from the /callback route once Google redirects back to us.
 * Saves both tokens to the google_health_accounts table.
 */
async function exchangeCodeForTokens(userId: string, code: string): Promise<void> {
  const response = await axios.post(GOOGLE_TOKEN_URL, {
    code,
    client_id:     env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  });

  const { access_token, refresh_token, expires_in } = response.data;

  // Use the userinfo endpoint to get the user's unique Google account ID.
  // This is more reliable than decoding the id_token ourselves — it works even
  // if the id_token is absent (e.g. when openid scope wasn't granted).
  const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const googleAccountId = userInfoResponse.data.sub as string;

  // Fetch the Google Health user ID (different from the OAuth account ID).
  // This is what Google sends in webhook notifications: e.g. "3624987878597428517".
  // We need it to reverse-look up our user when a webhook fires.
  let healthUserId: string | null = null;
  try {
    const healthUserResponse = await axios.get(
      `${GOOGLE_HEALTH_BASE}/users/me`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    healthUserId = healthUserResponse.data?.name?.replace('users/', '') ?? null;
  } catch {
    // Non-fatal: healthUserId can be populated on the next sync
    console.warn('⚠️  Could not fetch Google Health userId during OAuth');
  }

  // Upsert — if the user reconnects, update the existing record (don't create a duplicate)
  await prisma.googleHealthAccount.upsert({
    where:  { userId },
    update: {
      googleAccountId,
      ...(healthUserId ? { healthUserId } : {}),
      accessToken:    access_token,
      refreshToken:   refresh_token,
      tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
    },
    create: {
      userId,
      googleAccountId,
      ...(healthUserId ? { healthUserId } : {}),
      accessToken:    access_token,
      refreshToken:   refresh_token,
      tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
    },
  });
}

// ── Token Management ─────────────────────────────────────────────────────────

/**
 * Returns a valid access token for the user.
 * If the current token expires in less than 5 minutes, auto-refreshes it first.
 * (Identical logic to run.service.ts getValidAccessToken)
 */
async function getValidAccessToken(userId: string): Promise<string> {
  const account = await prisma.googleHealthAccount.findUnique({ where: { userId } });
  if (!account) throw new Error(`Google Health not connected for user ${userId}`);

  // Token is about to expire — refresh it
  if (account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
    const response = await axios.post(GOOGLE_TOKEN_URL, {
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: account.refreshToken,
    });

    const { access_token, expires_in } = response.data;

    await prisma.googleHealthAccount.update({
      where: { userId },
      data: {
        accessToken:    access_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
      },
    });

    return access_token;
  }

  return account.accessToken;
}

// ── Runner 3: Data Fetch ──────────────────────────────────────────────────────

/**
 * Fetch exercise/activity data points from the Google Health API.
 * Called after the webhook fires to get the actual workout details.
 *
 * API: GET /v4/users/me/dataTypes/exercise/dataPoints
 * Data type uses kebab-case in the URL path.
 */
async function fetchActivityData(userId: string, startTime: Date, endTime: Date) {
  const accessToken = await getValidAccessToken(userId);

  // AIP-160 filter syntax. Timestamps must be "YYYY-MM-DDTHH:mm:ss" — no Z, no milliseconds.
  const fmt = (d: Date) => d.toISOString().split('.')[0]; // strips .sssZ → "2026-05-28T00:00:00"
  const filter = [
    `exercise.interval.civil_start_time >= "${fmt(startTime)}"`,
    `exercise.interval.civil_start_time < "${fmt(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/exercise/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 25 },
    }
  );

  return response.data;
}

/**
 * Fetch sleep data points from the Google Health API.
 */
async function fetchSleepData(userId: string, startTime: Date, endTime: Date) {
  const accessToken = await getValidAccessToken(userId);

  // Sleep is filtered by civil_end_time (when the session finished).
  // Same "YYYY-MM-DDTHH:mm:ss" format — no Z suffix.
  const fmt = (d: Date) => d.toISOString().split('.')[0];
  const filter = [
    `sleep.interval.civil_end_time >= "${fmt(startTime)}"`,
    `sleep.interval.civil_end_time < "${fmt(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/sleep/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 25 },
    }
  );

  return response.data;
}

// ── Write: Exercise Sessions ─────────────────────────────────────────────────

// Maps VitalSync workout type strings to Google Health activity type codes.
function mapActivityType(type: 'strength' | 'run' | 'walk' | string): number {
  switch (type) {
    case 'strength': return 80; // STRENGTH_TRAINING
    case 'run':      return 56; // RUNNING
    case 'walk':     return 93; // WALKING
    default:         return 4;  // WORKOUT (generic fallback)
  }
}

// ── Sync: Normalizers ─────────────────────────────────────────────────────────

/**
 * Maps Google Health exercise type strings → our 3 simplified labels.
 * The REST API returns string enums (e.g. "RUNNING"), not numeric codes.
 * Numeric fallbacks are kept for any legacy data already in the DB.
 */
const GOOGLE_ACTIVITY_STRING_MAP: Record<string, 'run' | 'walk' | 'strength'> = {
  RUNNING:           'run',
  RUNNING_TREADMILL: 'run',
  JOGGING:           'run',
  TRAIL_RUNNING:     'run',
  WALKING:           'walk',
  WALKING_TREADMILL: 'walk',
  NORDIC_WALKING:    'walk',
  STAIR_CLIMBING:    'walk',
  HIKING:            'walk',
  STRENGTH_TRAINING: 'strength',
  WEIGHT_LIFTING:    'strength',
  CROSS_TRAINING:    'strength',
  CIRCUIT_TRAINING:  'strength',
  YOGA:              'strength',
  PILATES:           'strength',
};

const GOOGLE_ACTIVITY_NUMERIC_MAP: Record<number, 'run' | 'walk' | 'strength'> = {
  56: 'run', 57: 'run', 87: 'run',
  93: 'walk', 94: 'walk', 95: 'walk', 79: 'walk',
  80: 'strength', 82: 'strength', 99: 'strength',
};

function mapGoogleActivityToOurs(exerciseType: string | number): 'run' | 'walk' | 'strength' {
  if (typeof exerciseType === 'string') {
    return GOOGLE_ACTIVITY_STRING_MAP[exerciseType] ?? 'strength';
  }
  return GOOGLE_ACTIVITY_NUMERIC_MAP[exerciseType] ?? 'strength';
}

/**
 * Converts a raw Google Health exercise data point into our flat value shape:
 * { activityType, durationMinutes, calories, heartRate, distanceM, startTime, endTime }
 *
 * We use many fallbacks because the Google Health API response shape varies
 * depending on which wearable synced the data and which fields it supports.
 */
// Parses a Google duration string like "4554s" or "858.515s" into seconds.
const parseGoogleSeconds = (val: string | undefined): number | null => {
  if (val == null) return null;
  const n = parseFloat(String(val).replace('s', ''));
  return isNaN(n) ? null : n;
};

function normalizeExerciseDataPoint(dp: any) {
  const ex       = dp.data?.exercise ?? dp.exercise ?? {};
  const interval = ex.interval ?? {};
  const metrics  = ex.metricsSummary ?? {};

  // ── Timing ────────────────────────────────────────────────────────────────
  const startStr = interval.civilStartTime ?? interval.startTime ?? null;
  const endStr   = interval.civilEndTime   ?? interval.endTime   ?? null;
  const startMs  = startStr ? new Date(startStr).getTime() : null;
  const endMs    = endStr   ? new Date(endStr).getTime()   : null;

  const durationMinutes = (startMs && endMs && endMs > startMs)
    ? Math.round((endMs - startMs) / 60000)
    : null;

  // activeDuration is the real moving time (wall-clock minus any pauses)
  const activeDurationSecs = parseGoogleSeconds(ex.activeDuration);
  const activeDurationMinutes = activeDurationSecs != null
    ? Math.round(activeDurationSecs / 60)
    : null;

  // ── Calories ──────────────────────────────────────────────────────────────
  const calories = metrics.caloriesKcal
    ?? metrics.calories?.totalKcal
    ?? metrics.activeCalories?.kilocalories
    ?? null;

  // ── Heart rate ────────────────────────────────────────────────────────────
  const avgHrRaw = metrics.averageHeartRateBeatsPerMinute;
  const avgHr    = avgHrRaw != null ? parseInt(String(avgHrRaw), 10) : null;
  const heartRate = (avgHr && !isNaN(avgHr)) ? { avg: avgHr, max: avgHr } : null;

  // Active Zone Minutes — Fitbit's weighted cardio-load score
  const activeZoneMinutes = metrics.activeZoneMinutes != null
    ? parseInt(String(metrics.activeZoneMinutes), 10)
    : null;

  // Heart rate zone durations — Google sends strings like "4440s"; convert to minutes
  const zoneDurs = metrics.heartRateZoneDurations;
  const heartRateZones = zoneDurs ? {
    lightMins:    Math.round((parseGoogleSeconds(zoneDurs.lightTime)    ?? 0) / 60),
    moderateMins: Math.round((parseGoogleSeconds(zoneDurs.moderateTime) ?? 0) / 60),
    vigorousMins: Math.round((parseGoogleSeconds(zoneDurs.vigorousTime) ?? 0) / 60),
    peakMins:     Math.round((parseGoogleSeconds(zoneDurs.peakTime)     ?? 0) / 60),
  } : null;

  // ── Distance & movement ───────────────────────────────────────────────────
  const rawDistanceM = metrics.distanceMillimeters != null
    ? metrics.distanceMillimeters / 1000
    : metrics.distance?.meters
      ?? (metrics.distance?.kilometers ? metrics.distance.kilometers * 1000 : null)
      ?? ex.distance?.meters
      ?? null;

  const steps = metrics.steps != null
    ? parseInt(String(metrics.steps), 10)
    : null;

  // averagePaceSecondsPerMeter → min/km  (e.g. 0.52 s/m × 1000 / 60 = 8.67 min/km)
  const avgPaceMinPerKm = metrics.averagePaceSecondsPerMeter != null
    ? Math.round(metrics.averagePaceSecondsPerMeter * 1000 / 60 * 100) / 100
    : null;

  // Elevation: mm → m
  const elevationGainM = metrics.elevationGainMillimeters != null
    ? Math.round(metrics.elevationGainMillimeters / 1000 * 10) / 10
    : null;

  // ── Activity type ─────────────────────────────────────────────────────────
  const activityType = mapGoogleActivityToOurs(ex.exerciseType ?? 0);

  // Whether the user explicitly started the workout vs Fitbit auto-detected it
  const recordingMethod = dp.dataSource?.recordingMethod === 'ACTIVELY_MEASURED'
    ? 'manual'
    : 'auto';

  const hasGps = ex.exerciseMetadata?.hasGps ?? false;

  // ── Per-km splits (GPS runs only) ─────────────────────────────────────────
  const splits = Array.isArray(ex.splits) && ex.splits.length > 0
    ? ex.splits.map((s: any, i: number) => ({
        km:              i + 1,
        paceMinPerKm:    s.metricsSummary?.averagePaceSecondsPerMeter != null
          ? Math.round(s.metricsSummary.averagePaceSecondsPerMeter * 1000 / 60 * 100) / 100
          : null,
        durationSeconds: s.activeDuration
          ? Math.round(parseGoogleSeconds(s.activeDuration) ?? 0)
          : null,
      }))
    : null;

  return {
    // Identity
    activityType,
    rawExerciseType:      ex.exerciseType ?? null,
    recordingMethod,
    displayName:          ex.displayName  ?? null,
    hasGps,

    // Timing
    startTime:            startStr,
    endTime:              endStr,
    durationMinutes,
    activeDurationMinutes,

    // Energy & heart
    calories:             calories !== null ? Math.round(calories) : null,
    heartRate,
    activeZoneMinutes,
    heartRateZones,

    // Movement (null for strength)
    distanceM:            activityType !== 'strength' && rawDistanceM ? Math.round(rawDistanceM) : null,
    steps:                activityType !== 'strength' ? steps         : null,
    avgPaceMinPerKm:      activityType !== 'strength' ? avgPaceMinPerKm : null,
    elevationGainM:       activityType !== 'strength' ? elevationGainM  : null,

    // Splits (runs with GPS only)
    splits:               activityType === 'run' ? splits : null,
  };
}

/**
 * Converts a raw Google Health sleep data point into our flat value shape:
 * { durationMinutes, stages: { deep, rem, light, awake }, startTime, endTime, quality }
 */
function normalizeSleepDataPoint(dp: any) {
  const sl       = dp.data?.sleep ?? dp.sleep ?? {};
  const interval = sl.interval ?? {};

  const startStr = interval.civilStartTime ?? interval.startTime ?? null;
  const endStr   = interval.civilEndTime   ?? interval.endTime   ?? null;
  const startMs  = startStr ? new Date(startStr).getTime() : null;
  const endMs    = endStr   ? new Date(endStr).getTime()   : null;

  const durationMinutes = (startMs && endMs && endMs > startMs)
    ? Math.round((endMs - startMs) / 60000)
    : null;

  // Aggregate sleep stage durations into our 4-bucket map.
  //
  // Google provides two sources — we prefer the pre-computed summary because
  // it's a single pass and already totalled. The stages array is used as a
  // fallback (e.g. when summary is absent) and computes duration from
  // startTime/endTime because Google does not include a durationSeconds field.
  const stageMap = { deep: 0, rem: 0, light: 0, awake: 0 };

  const addMins = (name: string, mins: number) => {
    if      (name.includes('deep'))                           stageMap.deep  += mins;
    else if (name.includes('rem'))                            stageMap.rem   += mins;
    else if (name.includes('light'))                          stageMap.light += mins;
    else if (name.includes('awake') || name.includes('wake')) stageMap.awake += mins;
  };

  if (Array.isArray(sl.summary?.stagesSummary)) {
    // Primary path: pre-computed totals from Google's summary object
    for (const s of sl.summary.stagesSummary) {
      addMins((s.type ?? '').toLowerCase(), parseInt(String(s.minutes ?? 0), 10));
    }
  } else if (Array.isArray(sl.stages)) {
    // Fallback: derive duration from each stage's startTime/endTime
    for (const s of sl.stages) {
      const name = (s.stage ?? s.type ?? '').toLowerCase();
      let mins = 0;
      if (s.startTime && s.endTime) {
        mins = Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000);
      } else {
        mins = Math.round((s.durationSeconds ?? s.duration ?? 0) / 60);
      }
      addMins(name, mins);
    }
  }

  // minutesAsleep excludes time awake after falling asleep;
  // minutesInSleepPeriod is the full window from lights-out to wake-up.
  const summary = sl.summary ?? {};
  const minutesAsleep = summary.minutesAsleep != null
    ? parseInt(String(summary.minutesAsleep), 10)
    : null;
  const minutesAwake = summary.minutesAwake != null
    ? parseInt(String(summary.minutesAwake), 10)
    : null;

  return {
    durationMinutes,
    minutesAsleep,
    minutesAwake,
    stages:    stageMap,
    startTime: startStr,
    endTime:   endStr,
    quality:   sl.quality ?? null,
  };
}

// ── Normalizers: Additional Health Metrics ────────────────────────────────────

/**
 * Normalizes a daily resting heart rate data point from Google Health API.
 * Returns the date and resting HR in BPM.
 */
function normalizeRestingHRDataPoint(dp: any) {
  const rhr = dp.data?.dailyRestingHeartRate ?? dp.dailyRestingHeartRate ?? {};
  
  // Convert date object { year, month, day } to ISO date string
  let dateStr: string | null = null;
  if (rhr.date && typeof rhr.date === 'object') {
    const { year, month, day } = rhr.date;
    if (year && month && day) {
      dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  } else if (typeof rhr.date === 'string') {
    dateStr = rhr.date;
  }
  
  return {
    date: dateStr,
    restingHR: rhr.beatsPerMinute != null 
      ? parseInt(String(rhr.beatsPerMinute), 10) 
      : null,
  };
}

/**
 * Normalizes a daily HRV data point from Google Health API.
 * Returns the date and HRV RMSSD (root mean square of successive differences).
 * RMSSD is the most common HRV metric — higher values indicate better recovery.
 */
function normalizeHRVDataPoint(dp: any) {
  const hrv = dp.data?.dailyHeartRateVariability ?? dp.dailyHeartRateVariability ?? {};
  
  // Convert date object { year, month, day } to ISO date string
  let dateStr: string | null = null;
  if (hrv.date && typeof hrv.date === 'object') {
    const { year, month, day } = hrv.date;
    if (year && month && day) {
      dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  } else if (typeof hrv.date === 'string') {
    dateStr = hrv.date;
  }
  
  // The API returns HRV as averageHeartRateVariabilityMilliseconds (RMSSD)
  // and deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds
  const hrvRmssd = hrv.averageHeartRateVariabilityMilliseconds ?? hrv.hrvRmssd ?? null;
  const deepSleepRmssd = hrv.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds ?? null;
  
  return {
    date: dateStr,
    hrvRmssd: hrvRmssd != null 
      ? parseFloat(String(hrvRmssd)) 
      : null,
    deepSleepRmssd: deepSleepRmssd != null
      ? parseFloat(String(deepSleepRmssd))
      : null,
    entropy: hrv.entropy != null ? parseFloat(String(hrv.entropy)) : null,
  };
}

/**
 * Normalizes a VO2 Max data point from Google Health API.
 * Returns the sample time and VO2 Max value in mL/min/kg.
 * Higher values indicate better cardiorespiratory fitness.
 */
function normalizeVO2MaxDataPoint(dp: any) {
  const vo2 = dp.data?.vo2Max ?? dp.vo2Max ?? {};
  const sampleTime = vo2.sampleTime?.physicalTime ?? null;
  
  // The API returns vo2Max value directly in vo2Max.vo2Max field
  const vo2MaxValue = vo2.vo2Max ?? vo2.vo2MaxMlPerMinPerKg ?? null;
  
  return {
    sampleTime,
    vo2MaxMlPerMinPerKg: vo2MaxValue != null 
      ? parseFloat(String(vo2MaxValue)) 
      : null,
    fitnessLevel: vo2.fitnessLevel ?? null,
  };
}

/**
 * Normalizes a steps data point from Google Health API.
 * Returns the interval and step count.
 */
function normalizeStepsDataPoint(dp: any) {
  const steps = dp.data?.steps ?? dp.steps ?? {};
  const interval = steps.interval ?? {};

  // The API returns startTime as ISO string and count as the step count
  const startTime = interval.startTime ?? null;
  const endTime = interval.endTime ?? null;
  const count = steps.count ?? steps.steps ?? null;

  return {
    startTime,
    endTime,
    steps: count != null
      ? parseInt(String(count), 10)
      : null,
  };
}

/**
 * Aggregates multiple step data points into a daily total.
 * Google Health may return multiple step intervals per day.
 */
function aggregateDailySteps(dataPoints: any[]): { date: string; totalSteps: number }[] {
  const dailyMap = new Map<string, number>();
  
  for (const dp of dataPoints) {
    const normalized = normalizeStepsDataPoint(dp);
    if (!normalized.startTime || normalized.steps == null) continue;
    
    const date = normalized.startTime.split('T')[0];
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + normalized.steps);
  }
  
  return Array.from(dailyMap.entries())
    .map(([date, totalSteps]) => ({ date, totalSteps }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── Sync: Fetch + Persist ──────────────────────────────────────────────────────

/**
 * Sync result type with counts for all data types.
 */
export interface SyncResult {
  exerciseSynced: number;
  sleepSynced: number;
  restingHRSynced: number;
  hrvSynced: number;
  vo2MaxSynced: number;
  stepsSynced: number;
}

/**
 * Fetches the last `days` of health data from the Google Health API
 * and upserts each data point into the health_data_points table.
 *
 * Fetches 6 data types in parallel:
 *   - exercise (workouts)
 *   - sleep
 *   - resting_hr (daily resting heart rate)
 *   - hrv (daily heart rate variability)
 *   - vo2_max (cardio fitness)
 *   - steps (daily activity)
 *
 * Uses googleDataPointId (Google's own ID for the record) as the upsert key
 * so re-syncing the same period never creates duplicates.
 */
async function syncUserHealthData(
  userId: string,
  days = 30,
): Promise<SyncResult> {
  const endTime   = new Date();
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fire all 6 fetches in parallel — one failure won't block the others
  const [
    activityResult,
    sleepResult,
    rhrResult,
    hrvResult,
    vo2Result,
    stepsResult,
  ] = await Promise.allSettled([
    fetchActivityData(userId, startTime, endTime),
    fetchSleepData(userId, startTime, endTime),
    fetchRestingHeartRateData(userId, startTime, endTime),
    fetchHRVData(userId, startTime, endTime),
    fetchVO2MaxData(userId, startTime, endTime),
    fetchStepsData(userId, startTime, endTime),
  ]);

  const result: SyncResult = {
    exerciseSynced: 0,
    sleepSynced: 0,
    restingHRSynced: 0,
    hrvSynced: 0,
    vo2MaxSynced: 0,
    stepsSynced: 0,
  };

  // ── Exercise ────────────────────────────────────────────────────────────────
  if (activityResult.status === 'fulfilled') {
    const dataPoints: any[] = (activityResult.value as any)?.dataPoints ?? [];
    for (const dp of dataPoints) {
      const value = normalizeExerciseDataPoint(dp);
      if (!value.durationMinutes) continue; // skip incomplete / in-progress sessions

      const dpId       = (dp.name as string | undefined) ?? null;
      const recordedAt = value.startTime ? new Date(value.startTime) : new Date();
      const dedupeKey  = dpId ?? `gh-ex-${userId}-${recordedAt.getTime()}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'exercise', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.exerciseSynced++;
    }
  } else {
    console.warn('⚠️  Exercise sync failed:', activityResult.reason);
  }

  // ── Sleep ───────────────────────────────────────────────────────────────────
  if (sleepResult.status === 'fulfilled') {
    const dataPoints: any[] = (sleepResult.value as any)?.dataPoints ?? [];
    for (const dp of dataPoints) {
      const value = normalizeSleepDataPoint(dp);
      if (!value.durationMinutes) continue;

      const dpId       = (dp.name as string | undefined) ?? null;
      const recordedAt = value.endTime ? new Date(value.endTime) : new Date();
      const dedupeKey  = dpId ?? `gh-sl-${userId}-${recordedAt.getTime()}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'sleep', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.sleepSynced++;
    }
  } else {
    console.warn('⚠️  Sleep sync failed:', sleepResult.reason);
  }

  // ── Resting Heart Rate ──────────────────────────────────────────────────────
  if (rhrResult.status === 'fulfilled') {
    const dataPoints: any[] = (rhrResult.value as any)?.dataPoints ?? [];
    for (const dp of dataPoints) {
      const value = normalizeRestingHRDataPoint(dp);
      if (value.restingHR == null) continue;

      const dpId       = (dp.name as string | undefined) ?? null;
      const recordedAt = value.date ? new Date(value.date) : new Date();
      const dedupeKey  = dpId ?? `gh-rhr-${userId}-${value.date}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'resting_hr', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.restingHRSynced++;
    }
  } else {
    console.warn('⚠️  Resting HR sync failed:', rhrResult.reason);
  }

  // ── HRV ─────────────────────────────────────────────────────────────────────
  if (hrvResult.status === 'fulfilled') {
    const dataPoints: any[] = (hrvResult.value as any)?.dataPoints ?? [];
    for (const dp of dataPoints) {
      const value = normalizeHRVDataPoint(dp);
      if (value.hrvRmssd == null) continue;

      const dpId       = (dp.name as string | undefined) ?? null;
      const recordedAt = value.date ? new Date(value.date) : new Date();
      const dedupeKey  = dpId ?? `gh-hrv-${userId}-${value.date}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'hrv', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.hrvSynced++;
    }
  } else {
    console.warn('⚠️  HRV sync failed:', hrvResult.reason);
  }

  // ── VO2 Max ─────────────────────────────────────────────────────────────────
  if (vo2Result.status === 'fulfilled') {
    const dataPoints: any[] = (vo2Result.value as any)?.dataPoints ?? [];
    for (const dp of dataPoints) {
      const value = normalizeVO2MaxDataPoint(dp);
      if (value.vo2MaxMlPerMinPerKg == null) continue;

      const dpId       = (dp.name as string | undefined) ?? null;
      const recordedAt = value.sampleTime ? new Date(value.sampleTime) : new Date();
      const dedupeKey  = dpId ?? `gh-vo2-${userId}-${recordedAt.getTime()}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'vo2_max', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.vo2MaxSynced++;
    }
  } else {
    console.warn('⚠️  VO2 Max sync failed:', vo2Result.reason);
  }

  // ── Steps (aggregated daily) ────────────────────────────────────────────────
  if (stepsResult.status === 'fulfilled') {
    const dataPoints: any[] = (stepsResult.value as any)?.dataPoints ?? [];
    const dailySteps = aggregateDailySteps(dataPoints);
    
    for (const { date, totalSteps } of dailySteps) {
      const value = { date, totalSteps };
      const recordedAt = new Date(date);
      const dedupeKey = `gh-steps-${userId}-${date}`;

      await prisma.healthDataPoint.upsert({
        where:  { googleDataPointId: dedupeKey },
        update: { value },
        create: { userId, dataType: 'steps', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
      });
      result.stepsSynced++;
    }
  } else {
    console.warn('⚠️  Steps sync failed:', stepsResult.reason);
  }

  // Stamp lastSyncAt regardless of partial failures so the UI shows "last synced at…"
  await prisma.googleHealthAccount.update({
    where: { userId },
    data:  { lastSyncAt: new Date() },
  });

  // Update health summaries (weekly + monthly) with the new data
  try {
    await healthSummaryService.updateAllSummaries(userId);
  } catch (err) {
    console.warn('⚠️  Health summary update failed:', err);
  }

  return result;
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns workout HealthDataPoints for a user, newest first.
 * Spreads the stored JSON value into each row so the frontend gets a flat object.
 */
async function getWorkoutHistory(userId: string, days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.healthDataPoint.findMany({
    where:   { userId, dataType: 'exercise', recordedAt: { gte: cutoff } },
    orderBy: { recordedAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({ id: r.id, ...(r.value as Record<string, unknown>), recordedAt: r.recordedAt.toISOString() }));
}

/**
 * Returns sleep HealthDataPoints for a user, newest first.
 */
async function getSleepHistory(userId: string, days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.healthDataPoint.findMany({
    where:   { userId, dataType: 'sleep', recordedAt: { gte: cutoff } },
    orderBy: { recordedAt: 'desc' },
    take: 60,
  });
  return rows.map((r) => ({ id: r.id, ...(r.value as Record<string, unknown>), recordedAt: r.recordedAt.toISOString() }));
}

/**
 * Writes a completed exercise session to Google Health in one single PUT call.
 * Both startTime and endTime are sent together so the session is always complete.
 *
 * WHY one call instead of start + end:
 *   - PUT requires a full resource representation (no partial updates needed)
 *   - Avoids dangling "in-progress" sessions if the app crashes mid-workout
 *   - The Google Health REST API is designed for after-the-fact writes;
 *     live session tracking belongs in the native Health Connect Android SDK
 *
 * API: PUT /v4/users/me/sessions/{sessionId}
 */
async function writeExerciseSession(
  userId: string,
  session: {
    sessionId:    string;  // VitalSync workout ID — becomes the Google session ID
    name:         string;  // e.g. "Push Day"
    activityType: string;  // "strength" | "run"
    startTime:    Date;
    endTime:      Date;
  }
): Promise<void> {
  const accessToken = await getValidAccessToken(userId);

  await axios.put(
    `${GOOGLE_HEALTH_BASE}/users/me/sessions/${session.sessionId}`,
    {
      id:              session.sessionId,
      name:            session.name,
      startTimeMillis: session.startTime.getTime().toString(),
      endTimeMillis:   session.endTime.getTime().toString(),
      activityType:    mapActivityType(session.activityType),
      application: {
        packageName: 'com.vitalsync.app',
        name:        'VitalSync',
        version:     '1.0',
      },
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// ── Read: Additional Health Metrics ───────────────────────────────────────────

// Shared timestamp formatter: strips milliseconds and Z suffix.
// Google Health filter syntax requires "YYYY-MM-DDTHH:mm:ss" (no Z, no .sss).
const fmtTime = (d: Date): string => d.toISOString().split('.')[0];

// Date-only formatter for daily metrics (YYYY-MM-DD)
const fmtDate = (d: Date): string => d.toISOString().split('T')[0];

/**
 * Fetches daily resting heart rate data from Google Health API.
 * Resting HR is a key recovery indicator — elevated RHR suggests overtraining or illness.
 *
 * API: GET /v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints
 */
async function fetchRestingHeartRateData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<any> {
  const accessToken = await getValidAccessToken(userId);

  // Daily metrics use date-based filtering (YYYY-MM-DD format)
  const filter = [
    `daily_resting_heart_rate.date >= "${fmtDate(startTime)}"`,
    `daily_resting_heart_rate.date < "${fmtDate(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/daily-resting-heart-rate/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 100 },
    }
  );

  return response.data;
}

/**
 * Fetches daily heart rate variability (HRV) data from Google Health API.
 * HRV is the gold standard for recovery/readiness scoring.
 * Higher HRV generally indicates better recovery and lower stress.
 *
 * API: GET /v4/users/me/dataTypes/daily-heart-rate-variability/dataPoints
 */
async function fetchHRVData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<any> {
  const accessToken = await getValidAccessToken(userId);

  const filter = [
    `daily_heart_rate_variability.date >= "${fmtDate(startTime)}"`,
    `daily_heart_rate_variability.date < "${fmtDate(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/daily-heart-rate-variability/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 100 },
    }
  );

  return response.data;
}

/**
 * Fetches VO2 Max data from Google Health API.
 * VO2 Max measures cardiorespiratory fitness — higher is better.
 * Tracks aerobic improvement over time.
 *
 * Note: VO2 Max data is sparse (typically 1-2 readings per week after cardio workouts).
 * We fetch all available data and filter in code since the API filter syntax
 * for this data type is not well documented.
 *
 * API: GET /v4/users/me/dataTypes/vo2-max/dataPoints
 */
async function fetchVO2MaxData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<any> {
  const accessToken = await getValidAccessToken(userId);

  // VO2 Max data is sparse, so we fetch all and filter in code
  // The API filter syntax for vo2-max is not well documented
  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/vo2-max/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { pageSize: 100 },
    }
  );

  // Filter data points by date range in code
  const allDataPoints = response.data?.dataPoints ?? [];
  const filteredDataPoints = allDataPoints.filter((dp: any) => {
    const physicalTime = dp.vo2Max?.sampleTime?.physicalTime;
    if (!physicalTime) return false;
    const timestamp = new Date(physicalTime);
    return timestamp >= startTime && timestamp < endTime;
  });

  return { dataPoints: filteredDataPoints };
}

/**
 * Fetches daily steps data from Google Health API.
 * Steps indicate daily activity level and help detect sedentary behavior.
 *
 * API: GET /v4/users/me/dataTypes/steps/dataPoints
 */
async function fetchStepsData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<any> {
  const accessToken = await getValidAccessToken(userId);

  // Steps use interval-based filtering
  const filter = [
    `steps.interval.civil_start_time >= "${fmtTime(startTime)}"`,
    `steps.interval.civil_start_time < "${fmtTime(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/steps/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 500 },
    }
  );

  return response.data;
}

// ── Read: Vitals Fetch ────────────────────────────────────────────────────────

/**
 * Fetches heart rate samples recorded during a specific time window.
 * Returns null if no data exists (e.g. user has no wearable).
 *
 * API: GET /v4/users/me/dataTypes/heart-rate/dataPoints
 */
async function fetchHeartRateData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<{ average: number; max: number; min: number; samples: any[] } | null> {
  const accessToken = await getValidAccessToken(userId);

  // heart-rate uses physicalTime (UTC), not civil_start_time like exercise does
  const filter = [
    `heartRate.sampleTime.physicalTime >= "${fmtTime(startTime)}"`,
    `heartRate.sampleTime.physicalTime < "${fmtTime(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/heart-rate/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 1000 },
    }
  );

  const dataPoints: any[] = response.data?.dataPoints ?? [];
  if (dataPoints.length === 0) return null;

  // Extract the BPM value from each data point and compute summary stats
  const bpmValues: number[] = dataPoints
    .map((dp: any) => dp.data?.heartRate?.beatsPerMinute)
    .filter((v: any): v is number => typeof v === 'number');

  if (bpmValues.length === 0) return null;

  return {
    average: Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length),
    max:     Math.max(...bpmValues),
    min:     Math.min(...bpmValues),
    samples: dataPoints, // raw samples kept for the AI coach context
  };
}

/**
 * Fetches total calories burned during a specific time window.
 * Returns null if no data exists.
 *
 * API: GET /v4/users/me/dataTypes/total-calories/dataPoints
 */
async function fetchCaloriesData(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<{ total: number } | null> {
  const accessToken = await getValidAccessToken(userId);

  const filter = [
    `total_calories.interval.civil_start_time >= "${fmtTime(startTime)}"`,
    `total_calories.interval.civil_start_time < "${fmtTime(endTime)}"`,
  ].join(' AND ');

  const response = await axios.get(
    `${GOOGLE_HEALTH_BASE}/users/me/dataTypes/total-calories/dataPoints`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { filter, pageSize: 100 },
    }
  );

  const dataPoints: any[] = response.data?.dataPoints ?? [];
  if (dataPoints.length === 0) return null;

  const total = dataPoints
    .map((dp: any) => dp.data?.totalCalories?.kilocalories ?? 0)
    .reduce((sum: number, v: number) => sum + v, 0);

  return { total: Math.round(total) };
}

/**
 * Fetches all vitals for a workout in a single parallel call.
 * Uses Promise.allSettled so a failure on one type (e.g. no heart rate from wearable)
 * never blocks the others from succeeding.
 *
 * Returns a combined object — null fields mean the data wasn't available.
 */
async function fetchWorkoutVitals(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<{
  heartRate: { average: number; max: number; min: number; samples: any[] } | null;
  calories:  { total: number } | null;
}> {
  const [hrResult, calResult] = await Promise.allSettled([
    fetchHeartRateData(userId, startTime, endTime),
    fetchCaloriesData(userId, startTime, endTime),
  ]);

  return {
    heartRate: hrResult.status  === 'fulfilled' ? hrResult.value  : null,
    calories:  calResult.status === 'fulfilled' ? calResult.value : null,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Check if a user has a connected Google Health account.
 * Used by the Profile page to show the "Connect / Disconnect" button state.
 */
async function getConnectionStatus(userId: string) {
  const account = await prisma.googleHealthAccount.findUnique({
    where:  { userId },
    select: { googleAccountId: true, lastSyncAt: true, createdAt: true },
  });
  return { connected: !!account, account };
}

/**
 * Revoke the user's Google token and delete the account record from our DB.
 * Called when the user clicks "Disconnect Google Health" in their profile.
 */
async function disconnectAccount(userId: string): Promise<void> {
  const account = await prisma.googleHealthAccount.findUnique({ where: { userId } });
  if (!account) return;

  // Best-effort revocation — Google revokes the token server-side so it can't be reused
  try {
    await axios.post(
      `https://oauth2.googleapis.com/revoke?token=${account.accessToken}`
    );
  } catch {
    // If revocation fails (e.g. already expired), we still clean up locally
  }

  await prisma.googleHealthAccount.delete({ where: { userId } });
}

// ── Webhook Helpers ───────────────────────────────────────────────────────────

/**
 * Looks up a VitalSync userId from Google's internal health user ID.
 *
 * When Google fires a webhook, the payload contains healthUserId
 * (e.g. "3624987878597428517") — NOT our UUID. This function maps
 * Google's ID → our user ID so we know whose data to fetch.
 *
 * Returns null if no matching user is found (e.g. webhook for unknown user).
 */
async function findUserByHealthUserId(healthUserId: string): Promise<string | null> {
  const account = await prisma.googleHealthAccount.findUnique({
    where:  { healthUserId },
    select: { userId: true },
  });
  return account?.userId ?? null;
}

/**
 * Syncs only sleep data for a user — used immediately when a sleep webhook fires.
 * More focused than syncUserHealthData (which fetches all 6 types).
 */
async function syncSleepData(userId: string): Promise<number> {
  const endTime   = new Date();
  const startTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // last 2 days

  const data = await fetchSleepData(userId, startTime, endTime);
  const dataPoints: any[] = (data as any)?.dataPoints ?? [];
  let synced = 0;

  for (const dp of dataPoints) {
    const value = normalizeSleepDataPoint(dp);
    if (!value.durationMinutes) continue;

    const dpId       = (dp.name as string | undefined) ?? null;
    const recordedAt = value.endTime ? new Date(value.endTime) : new Date();
    const dedupeKey  = dpId ?? `gh-sleep-${userId}-${recordedAt.getTime()}`;

    await prisma.healthDataPoint.upsert({
      where:  { googleDataPointId: dedupeKey },
      update: { value },
      create: { userId, dataType: 'sleep', value, recordedAt, source: 'google_health', googleDataPointId: dedupeKey },
    });
    synced++;
  }

  return synced;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const googleHealthService = {
  // OAuth
  getAuthUrl,
  exchangeCodeForTokens,
  // Token management
  getValidAccessToken,
  // Write
  writeExerciseSession,
  // Raw fetch (used by sync + DEV routes)
  fetchActivityData,
  fetchSleepData,
  fetchHeartRateData,
  fetchCaloriesData,
  fetchWorkoutVitals,
  // New: Additional health metrics fetch
  fetchRestingHeartRateData,
  fetchHRVData,
  fetchVO2MaxData,
  fetchStepsData,
  // Sync pipeline
  syncUserHealthData,
  syncSleepData,
  // Webhook helpers
  findUserByHealthUserId,
  // Query helpers (read from HealthDataPoint table)
  getWorkoutHistory,
  getSleepHistory,
  // Utilities
  getConnectionStatus,
  disconnectAccount,
};
