import { Router } from 'express';
import { workoutService } from '../services/workout.service';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { logWorkoutSchema } from '../validators/workout.validator';

const router = Router();

// ==========================================
// POST /api/workouts/complete
// Receives an entire finished workout payload
// ==========================================
router.post(
    '/complete',
    authenticate,
    asyncHandler(async (req, res) => {
        const input = logWorkoutSchema.parse({ body: req.body });
        
        const workout = await workoutService.logCompletedWorkout({
            userId: req.user!.userId,
            ...input.body
        });

        res.status(201).json({ workout });
    })
);

// ==========================================
// GET /api/workouts
// Retrieves all workouts for the user
// ==========================================
router.get(
    '/',
    authenticate,
    asyncHandler(async (req, res) => {
        const workouts = await workoutService.getUserWorkouts(req.user!.userId);
        res.status(200).json({ workouts });
    })
);
// ==========================================
// GET /api/workouts/templates/:id
// Retrieves a template and auto-populates historical weights
// ==========================================
router.get(
    '/templates/:id',
    authenticate,
    asyncHandler(async (req, res) => {
        const template = await workoutService.getTemplateWithHistoricalWeights(req.user!.userId, req.params.id as string);
        res.status(200).json({ template });
    })
);

export default router;
