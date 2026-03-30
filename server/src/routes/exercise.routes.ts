import { Router } from 'express';
import { exerciseService } from '../services/exercise.service';
import { authenticate } from '../middleware/authenticate';
import { getExerciseSchema } from '../validators/exercise.validator';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/exercises
// Protected route: Returns a catalog of exercises
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    // 1. Zod deeply validates the incoming ?search= text
    const input = getExerciseSchema.parse({ query: req.query });

    // 2. Fetch from DB
    const exercises = await exerciseService.getExercises(input.query);

    // 3. Send to user
    res.json({ exercises });
  })
);

export default router;
