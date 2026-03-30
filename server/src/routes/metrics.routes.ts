import { Router } from 'express';
import { metricsService } from '../services/metrics.service';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { logWeightSchema, getWeightRangeSchema, logHabitsSchema, updateHabitSchema, getHabitsRangeSchema } from '../validators/metrics.validator';

const router = Router();

// ==========================================
// BODY WEIGHT
// ==========================================

// POST /api/metrics/weight
router.post(
  '/weight',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = logWeightSchema.parse({ body: req.body });
    const log = await metricsService.logWeight({
      userId: req.user!.userId,
      ...input.body
    });
    res.status(201).json({ log });
  })
);

// GET /api/metrics/weight?range=30d
router.get(
  '/weight',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = getWeightRangeSchema.parse({ query: req.query });
    const days = parseInt(input.query.range.replace('d', ''));
    const history = await metricsService.getWeightHistory(req.user!.userId, days);
    res.json({ history });
  })
);

// ==========================================
// HABITS
// ==========================================

// POST /api/metrics/habits
router.post(
  '/habits',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = logHabitsSchema.parse({ body: req.body });
    const log = await metricsService.logHabits({
      userId: req.user!.userId,
      ...input.body
    });
    res.status(201).json({ log });
  })
);

// GET /api/metrics/habits?range=30d
router.get(
  '/habits',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = getHabitsRangeSchema.parse({ query: req.query });
    const days = parseInt(input.query.range.replace('d', ''));
    const history = await metricsService.getHabitsHistory(req.user!.userId, days);
    res.json({ history });
  })
);

// GET /api/metrics/streaks
router.get(
  '/streaks',
  authenticate,
  asyncHandler(async (req, res) => {
    const streaks = await metricsService.getStreaks(req.user!.userId);
    res.json({ streaks });
  })
);

export default router;
