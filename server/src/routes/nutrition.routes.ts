import { Router } from 'express';
import { nutritionService } from '../services/nutrition.service';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { logNutritionSchema, getNutritionByDateSchema } from '../validators/nutrition.validator';

const router = Router();

// ==========================================
// POST /api/nutrition
// Logs a new food entry
// ==========================================
router.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = logNutritionSchema.parse({ body: req.body });
    const log = await nutritionService.logFood({
      userId: req.user!.userId,
      ...input.body
    });
    res.status(201).json({ log });
  })
);

// ==========================================
// GET /api/nutrition?date=YYYY-MM-DD
// Gets all logs and macro totals for a specific date
// ==========================================
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = getNutritionByDateSchema.parse({ query: req.query });
    const result = await nutritionService.getNutritionForDate(
      req.user!.userId,
      input.query.date
    );
    res.json(result); // returns { logs: [...], totals: {...} }
  })
);

// ==========================================
// DELETE /api/nutrition/:id
// Removes a food entry
// ==========================================
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    await nutritionService.deleteLog(req.user!.userId, req.params.id as string);
    res.status(204).send();
  })
);

export default router;
