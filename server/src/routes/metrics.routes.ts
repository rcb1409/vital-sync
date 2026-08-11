import { Router } from 'express';
import { metricsService } from '../services/metrics.service';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { logWeightSchema, getWeightRangeSchema } from '../validators/metrics.validator';

const router = Router();

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

export default router;
