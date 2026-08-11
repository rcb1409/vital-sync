// -------------------------------------------------------
// Google Health Routes
// -------------------------------------------------------
// Handles the OAuth connect/callback flow and webhook.
// Mirrors the pattern in strava.routes.ts.
//
// GET    /api/google-health/connect     → redirect user to Google consent page
// GET    /api/google-health/callback    → Google redirects back here with code
// GET    /api/google-health/status      → is this user connected?
// DELETE /api/google-health/disconnect  → revoke and remove connection
// POST   /api/google-health/webhook     → receives notifications from Google
// -------------------------------------------------------

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { googleHealthService } from '../services/googleHealth.service';
import { sleepRecoveryQueue } from '../config/queue';
import { env } from '../config/env';

const router = Router();

// ──────────────────────────────────────────────────────────────
// 1. GET /api/google-health/connect
// Returns the Google OAuth URL for the frontend to redirect to.
// The user clicks "Connect Google Health" → frontend hits this →
// we send back the URL → frontend redirects the user's browser to Google.
// ──────────────────────────────────────────────────────────────
router.get(
  '/connect',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const url = googleHealthService.getAuthUrl(userId);
    res.json({ url });
  })
);

// ──────────────────────────────────────────────────────────────
// 2. GET /api/google-health/callback
// Google redirects here after the user clicks Allow/Deny.
// No auth middleware — Google calls this directly (not our frontend).
// The userId comes back in the `state` param we set in getAuthUrl().
// ──────────────────────────────────────────────────────────────
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state: userId, error } = req.query;

    // User clicked "Deny" on Google's consent page
    if (error) {
      return res.redirect('http://localhost:5173/profile?google_error=access_denied');
    }

    if (!code || !userId) {
      return res.status(400).json({ error: 'Missing code or state from Google callback' });
    }

    // Exchange the one-time code for tokens and save to DB
    await googleHealthService.exchangeCodeForTokens(userId as string, code as string);

    // Redirect back to the Profile page with a success flag
    res.redirect('http://localhost:5173/profile?google_connected=true');
  })
);

// ──────────────────────────────────────────────────────────────
// 3. GET /api/google-health/status
// The Profile page calls this to know whether to show
// "Connect Google Health" or "Connected ✓ / Disconnect".
// ──────────────────────────────────────────────────────────────
router.get(
  '/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const status = await googleHealthService.getConnectionStatus(req.user!.userId);
    res.json(status);
  })
);

// ──────────────────────────────────────────────────────────────
// 4. DELETE /api/google-health/disconnect
// Revokes the token with Google and removes the record from our DB.
// ──────────────────────────────────────────────────────────────
router.delete(
  '/disconnect',
  authenticate,
  asyncHandler(async (req, res) => {
    await googleHealthService.disconnectAccount(req.user!.userId);
    res.json({ success: true, message: 'Google Health account disconnected' });
  })
);

// ──────────────────────────────────────────────────────────────
// 5. POST /api/google-health/webhook
// Google POSTs here whenever a user has new health data.
// NO auth middleware — this is called by Google's servers, not our users.
// We verify the request is genuine using the webhook secret header.
//
// What happens here (keep it fast — Google expects 200 within 10 seconds):
//   a) Respond 200 immediately
//   b) Fetch sleep data right away (it's ready as soon as the webhook fires)
//   c) Enqueue a delayed job to fetch HRV + RHR 20 minutes later
//      (those metrics are calculated from the sleep session and take time)
// ──────────────────────────────────────────────────────────────
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    // Google sends your secret in the Authorization header as "Bearer <secret>"
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${env.GOOGLE_HEALTH_WEBHOOK_SECRET}`) {
      console.warn('⚠️  Webhook received with invalid Authorization header — rejecting');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Google sends this first to verify the endpoint is alive before registering
    if (req.body?.type === 'verification') {
      console.log('✅ Google Health webhook verification handshake received');
      return res.status(200).json({ received: true });
    }

    // Real notification — respond 200 BEFORE doing any work
    // Google retries if it doesn't get a 200 within 10 seconds
    const { healthUserId, dataType } = req.body;
    console.log(`🔔 Webhook received: healthUserId=${healthUserId} dataType=${dataType}`);
    res.status(200).json({ received: true });

    // From here, run async (response already sent above)
    try {
      // Step A: Map Google's healthUserId → our internal userId
      const userId = await googleHealthService.findUserByHealthUserId(healthUserId);
      if (!userId) {
        console.warn(`⚠️  Webhook: no VitalSync user found for healthUserId=${healthUserId}`);
        return;
      }

      if (dataType === 'sleep') {
        // Step B: Fetch + store the sleep session immediately (it's available now)
        const synced = await googleHealthService.syncSleepData(userId);
        console.log(`✅ Webhook: synced ${synced} sleep session(s) for user ${userId}`);

        // Step C: Schedule a delayed job to fetch HRV + RHR once they're calculated
        // HRV and Resting HR are derived from sleep and take ~15-20 min after waking
        await sleepRecoveryQueue.add(
          'fetch-recovery',
          { userId },
          {
            delay: 20 * 60 * 1000, // 20 minutes in milliseconds
            jobId: `recovery-${userId}-${new Date().toISOString().split('T')[0]}`, // one per user per day
          }
        );
        console.log(`⏰ Webhook: scheduled recovery fetch for user ${userId} in 20 minutes`);

      } else if (dataType === 'exercise') {
        // For workouts: sync immediately (no delay needed — all workout data is ready now)
        await googleHealthService.syncUserHealthData(userId, 1);
        console.log(`✅ Webhook: synced exercise data for user ${userId}`);
      }

    } catch (err: any) {
      console.error(`❌ Webhook processing error: ${err.message}`);
    }
  })
);

// ──────────────────────────────────────────────────────────────
// 6. POST /api/google-health/sync
// Pulls the latest exercise + sleep data from Google Health
// and upserts it into the health_data_points table.
//
// QUERY PARAMS (optional):
//   ?days=30   → how many days back to sync (default: 30)
// ──────────────────────────────────────────────────────────────
router.post(
  '/sync',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;

    const result = await googleHealthService.syncUserHealthData(userId, days);

    res.json({
      success: true,
      message: `Synced ${result.exerciseSynced} workouts and ${result.sleepSynced} sleep sessions.`,
      ...result,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// 7. GET /api/google-health/workouts
// Returns workout HealthDataPoints from our database (already synced).
//
// QUERY PARAMS (optional):
//   ?days=30   → how many days back to query (default: 30)
// ──────────────────────────────────────────────────────────────
router.get(
  '/workouts',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;
    const workouts = await googleHealthService.getWorkoutHistory(userId, days);
    res.json({ workouts });
  })
);

// ──────────────────────────────────────────────────────────────
// 8. GET /api/google-health/sleep
// Returns sleep HealthDataPoints from our database (already synced).
//
// QUERY PARAMS (optional):
//   ?days=30   → how many days back to query (default: 30)
// ──────────────────────────────────────────────────────────────
router.get(
  '/sleep',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;
    const sleep = await googleHealthService.getSleepHistory(userId, days);
    res.json({ sleep });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/debug-token
// Tests token refresh and shows detailed error info.
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/debug-token',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    
    try {
      // This will attempt to refresh the token if expired
      const accessToken = await googleHealthService.getValidAccessToken(userId);
      
      // Try a simple API call
      const { default: axios } = await import('axios');
      const testResponse = await axios.get(
        'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { pageSize: 1 },
        }
      );
      
      res.json({
        status: 'success',
        tokenRefreshed: true,
        tokenPreview: accessToken.substring(0, 20) + '...',
        testApiCall: 'success',
        dataPointCount: testResponse.data?.dataPoints?.length ?? 0,
      });
    } catch (err: any) {
      res.json({
        status: 'error',
        error: err.message,
        response: err.response?.data ?? null,
        statusCode: err.response?.status ?? null,
      });
    }
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-activity
// Fetches exercise data points from Google Health and returns
// the raw JSON response unchanged.
//
// QUERY PARAMS (all optional):
//   ?days=7                              → last N days (default: 30)
//   ?startDate=2026-05-30T19:00:00Z     → exact ISO start time
//   ?endDate=2026-05-30T20:00:00Z       → exact ISO end time
//
// If startDate/endDate are provided they take priority over ?days.
//
// PURPOSE: Test what metricsSummary looks like for a specific
//   workout window — does it include heart rate, calories, zones?
//
// TODO: Remove this route before going to production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-activity',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    let startTime: Date;
    let endTime: Date;

    if (req.query.startDate && req.query.endDate) {
      // Explicit window supplied — use it directly
      startTime = new Date(req.query.startDate as string);
      endTime = new Date(req.query.endDate as string);

      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        return res.status(400).json({ error: 'Invalid startDate or endDate. Use ISO 8601 format e.g. 2026-05-30T19:00:00Z' });
      }
    } else {
      // Rolling window: last N days
      const days = parseInt(req.query.days as string) || 30;
      endTime = new Date();
      startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    const raw = await googleHealthService.fetchActivityData(userId, startTime, endTime);

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        userId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataPointCount: (raw as any)?.dataPoints?.length ?? 0,
      },
      raw,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — POST /api/google-health/test/start-session
// Writes a workout START to Google Health.
// Call this when a VitalSync workout begins.
//
// Body: { name?: string, activityType?: string }
// Returns: { googleDataPointId, startTime } — save these to call end-session
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.post(
  '/test/start-session',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const accessToken = await googleHealthService.getValidAccessToken(userId);
    const { default: axios } = await import('axios');

    const startTime = new Date();
    const name = req.body.name || 'VitalSync Test Workout';
    const activityType = req.body.activityType || 80; // 80 = STRENGTH_TRAINING

    // POST to create the data point with only startTime (no endTime = "in progress")
    const response = await axios.post(
      'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints',
      {
        exercise: {
          interval: {
            startTime: startTime.toISOString(),
          },
          exerciseType: typeof activityType === 'string'
            ? (activityType === 'run' ? 'RUNNING' : 'STRENGTH_TRAINING')
            : activityType,
          displayName: name,
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    res.json({
      _meta: { note: 'DEV ONLY', startTime: startTime.toISOString() },
      writtenDataPoint: response.data,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — POST /api/google-health/test/end-session
// Writes the END time for a session and then reads it back.
// Call this when a VitalSync workout finishes.
//
// Body: { dataPointName: string, startTime: string }
//   dataPointName = the `name` field from the start-session response
//   startTime     = ISO string from start-session response
//
// Returns the full exercise data point — check if metricsSummary is populated
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.post(
  '/test/end-session',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const accessToken = await googleHealthService.getValidAccessToken(userId);
    const { default: axios } = await import('axios');

    const { dataPointName, startTime } = req.body;
    if (!dataPointName || !startTime) {
      return res.status(400).json({ error: 'dataPointName and startTime are required (from start-session response)' });
    }

    const endTime = new Date();

    // PATCH the existing data point to add the end time
    await axios.patch(
      `https://health.googleapis.com/v4/${dataPointName}?updateMask=exercise.interval.endTime`,
      {
        exercise: {
          interval: { endTime: endTime.toISOString() },
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    // Wait 3s for Google to process, then read it back
    await new Promise(r => setTimeout(r, 3000));

    const start = new Date(startTime);
    const readBack = await googleHealthService.fetchActivityData(userId, start, endTime);

    res.json({
      _meta: {
        note: 'DEV ONLY',
        startTime: start.toISOString(),
        endTime: endTime.toISOString(),
        question: 'Is metricsSummary populated on our written session? Did Fitbit HR/calorie data attach?',
      },
      readBack,
    });
  })
);


// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-heart-rate
// Queries the heart-rate data type (NOT the exercise type) for
// a specific time window.
//
// This answers: does the watch record HR continuously even when
// no exercise session was detected?
//
// QUERY PARAMS:
//   ?startDate=2026-05-30T19:00:00Z
//   ?endDate=2026-05-30T20:00:00Z
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-heart-rate',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const accessToken = await googleHealthService.getValidAccessToken(userId);

    const startDate = req.query.startDate as string || '2026-05-28T04:00:00Z';
    const endDate = req.query.endDate as string || '2026-05-29T04:00:00Z';

    const startTime = new Date(startDate);
    const endTime = new Date(endDate);
    const fmt = (d: Date) => d.toISOString().split('.')[0];

    const { default: axios } = await import('axios');

    // Try both filter syntaxes — the correct one will work, 400 means wrong field name
    // Heart rate is a Sample type (not interval like exercise), filter may not be supported
    let response: any;
    let filterUsed = 'none';
    try {
      // Try snake_case (matches exercise pattern: civil_start_time)
      const filter = `heart_rate.sample_time.physical_time >= "${fmt(startTime)}" AND heart_rate.sample_time.physical_time < "${fmt(endTime)}"`;
      filterUsed = filter;
      response = await axios.get(
        'https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints',
        { headers: { Authorization: `Bearer ${accessToken}` }, params: { filter, pageSize: 5 } }
      );
    } catch {
      // Filter not supported — fall back to unfiltered, filter in code
      filterUsed = 'NONE (not supported, filtering in code)';
      const raw = await axios.get(
        'https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints',
        { headers: { Authorization: `Bearer ${accessToken}` }, params: { pageSize: 100 } }
      );
      // Filter in code by physicalTime
      const allPoints = raw.data?.dataPoints ?? [];
      const filtered = allPoints.filter((dp: any) => {
        const t = new Date(dp.heartRate?.sampleTime?.physicalTime);
        return t >= startTime && t < endTime;
      });
      response = { data: { dataPoints: filtered } };
    }

    const dataPoints = response.data?.dataPoints ?? [];

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        sampleCount: dataPoints.length,
        question: 'Does watch record HR continuously even without a detected exercise session?',
      },
      raw: response.data,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-resting-hr
// Queries the daily-resting-heart-rate data type.
// Returns daily resting HR values (one per day).
//
// QUERY PARAMS:
//   ?days=30   → last N days (default: 30)
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-resting-hr',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;
    
    const endTime = new Date();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const raw = await googleHealthService.fetchRestingHeartRateData(userId, startTime, endTime);

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        userId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataPointCount: (raw as any)?.dataPoints?.length ?? 0,
      },
      raw,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-hrv
// Queries the daily-heart-rate-variability data type.
// Returns daily HRV RMSSD values (one per day).
//
// QUERY PARAMS:
//   ?days=30   → last N days (default: 30)
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-hrv',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;
    
    const endTime = new Date();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const raw = await googleHealthService.fetchHRVData(userId, startTime, endTime);

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        userId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataPointCount: (raw as any)?.dataPoints?.length ?? 0,
      },
      raw,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-vo2max
// Queries the vo2-max data type.
// Returns VO2 Max readings (cardio fitness level).
//
// QUERY PARAMS:
//   ?days=30   → last N days (default: 30)
//   ?nofilter=true → skip date filter (debug)
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-vo2max',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;
    const noFilter = req.query.nofilter === 'true';
    
    const endTime = new Date();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // If nofilter is set, try fetching without date filter to debug
    if (noFilter) {
      const accessToken = await googleHealthService.getValidAccessToken(userId);
      const { default: axios } = await import('axios');
      
      try {
        const response = await axios.get(
          'https://health.googleapis.com/v4/users/me/dataTypes/vo2-max/dataPoints',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { pageSize: 10 },
          }
        );
        
        return res.json({
          _meta: {
            note: 'DEV ONLY — no filter applied',
            userId,
            dataPointCount: response.data?.dataPoints?.length ?? 0,
          },
          raw: response.data,
        });
      } catch (err: any) {
        return res.json({
          _meta: { note: 'DEV ONLY — error with no filter' },
          error: err.message,
          response: err.response?.data ?? null,
          statusCode: err.response?.status ?? null,
        });
      }
    }

    try {
      const raw = await googleHealthService.fetchVO2MaxData(userId, startTime, endTime);

      res.json({
        _meta: {
          note: 'DEV ONLY — remove before production',
          userId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          dataPointCount: (raw as any)?.dataPoints?.length ?? 0,
        },
        raw,
      });
    } catch (err: any) {
      res.json({
        _meta: { note: 'DEV ONLY — error' },
        error: err.message,
        response: err.response?.data ?? null,
        statusCode: err.response?.status ?? null,
      });
    }
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/raw-steps
// Queries the steps data type.
// Returns step count intervals.
//
// QUERY PARAMS:
//   ?days=7   → last N days (default: 7)
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/raw-steps',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 7;
    
    const endTime = new Date();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const raw = await googleHealthService.fetchStepsData(userId, startTime, endTime);

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        userId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataPointCount: (raw as any)?.dataPoints?.length ?? 0,
      },
      raw,
    });
  })
);

// ──────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/google-health/test/all-data-types
// Tests ALL data types in one call and returns a summary.
// Useful for quickly checking what data is available.
//
// QUERY PARAMS:
//   ?days=7   → last N days (default: 7)
//
// TODO: Remove before production.
// ──────────────────────────────────────────────────────────────
router.get(
  '/test/all-data-types',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 7;
    
    const endTime = new Date();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch all data types in parallel
    const [
      activityResult,
      sleepResult,
      rhrResult,
      hrvResult,
      vo2Result,
      stepsResult,
    ] = await Promise.allSettled([
      googleHealthService.fetchActivityData(userId, startTime, endTime),
      googleHealthService.fetchSleepData(userId, startTime, endTime),
      googleHealthService.fetchRestingHeartRateData(userId, startTime, endTime),
      googleHealthService.fetchHRVData(userId, startTime, endTime),
      googleHealthService.fetchVO2MaxData(userId, startTime, endTime),
      googleHealthService.fetchStepsData(userId, startTime, endTime),
    ]);

    const extractResult = (result: PromiseSettledResult<any>, name: string) => {
      if (result.status === 'fulfilled') {
        const dataPoints = result.value?.dataPoints ?? [];
        return {
          status: 'success',
          count: dataPoints.length,
          sample: dataPoints[0] ?? null,
        };
      } else {
        return {
          status: 'error',
          error: result.reason?.message ?? String(result.reason),
        };
      }
    };

    res.json({
      _meta: {
        note: 'DEV ONLY — remove before production',
        userId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        days,
      },
      results: {
        exercise: extractResult(activityResult, 'exercise'),
        sleep: extractResult(sleepResult, 'sleep'),
        restingHR: extractResult(rhrResult, 'resting_hr'),
        hrv: extractResult(hrvResult, 'hrv'),
        vo2Max: extractResult(vo2Result, 'vo2_max'),
        steps: extractResult(stepsResult, 'steps'),
      },
    });
  })
);

export default router;
