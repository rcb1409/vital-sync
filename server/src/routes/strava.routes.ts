import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { runService } from '../services/run.service';

const router = Router();

// ==========================================
// 1. GET /api/strava/connect
// Redirects the user to Strava's OAuth page
// ==========================================
router.get(
    '/connect',
    authenticate,
    asyncHandler(async (req, res) => {
        // We pass the userId in the 'state' parameter so when Strava redirects back, 
        // we know WHICH VitalSync user this Strava account belongs to!
        const state = req.user!.userId;
        const redirectUri = encodeURIComponent(`http://localhost:4000/api/strava/callback`);
        const clientId = process.env.STRAVA_CLIENT_ID;

        const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=activity:read_all&state=${state}`;
        res.json({ url: stravaAuthUrl });
    })
);

// ==========================================
// 2. GET /api/strava/callback
// Handles the redirect back from Strava
// ==========================================
router.get(
    '/callback',
    asyncHandler(async (req, res) => {
        const { code, state: userId, error } = req.query;

        // If the user clicked "Cancel" on the consent screen
        if (error) {
            return res.redirect('http://localhost:5173/runs?error=access_denied');
        }

        if (!code || !userId) {
            return res.status(400).json({ error: 'Missing code or state parameters' });
        }

        // Exchange the code for tokens and save to DB
        await runService.connectStravaAccount(userId as string, code as string);

        // Instantly trigger a sync of their recent activities!
        await runService.syncRecentActivities(userId as string);

        // Redirect back to our frontend React app
        res.redirect('http://localhost:5173/runs?synced=true');
    })
);

export default router;