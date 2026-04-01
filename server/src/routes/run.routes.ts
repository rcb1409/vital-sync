import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { runService } from '../services/run.service';
import { logManualRunSchema } from '../validators/run.validator';

const router = Router();

// ==========================================
// GET /api/runs/history
// Returns all synced Strava & manual runs
// ==========================================
router.get(
    '/history',
    authenticate,
    asyncHandler(async (req, res) => {
        const history = await runService.getActivitiesHistory(req.user!.userId);
        res.json({ history });
    })
);

// ==========================================
// POST /api/runs/sync
// Manually triggers a Strava Sync
// ==========================================
router.post(
    '/sync',
    authenticate,
    asyncHandler(async (req, res) => {
        const result = await runService.syncRecentActivities(req.user!.userId);
        res.json(result);
    })
);

// ==========================================
// POST /api/runs/manual
// Future endpoint for manual non-Strava runs
// ==========================================
// router.post('/manual', authenticate, asyncHandler(async (req, res) => { ... }));

export default router;
