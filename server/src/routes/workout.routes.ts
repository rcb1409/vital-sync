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

export default router;
