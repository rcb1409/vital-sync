import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { updateProfileSchema } from '../validators/user.validator';
import { userService } from '../services/user.service';

const router = Router();
router.get('/profile', authenticate, async (req, res, next) => {
    try {
        const userProfile = await userService.getProfile(req.user!.userId);
        res.json({ user: userProfile });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/users/profile
router.patch('/profile', authenticate, async (req, res, next) => {
    try {
        // 1. Validate incoming data (Zod)
        const validatedData = updateProfileSchema.parse(req.body);
        // 2. Pass clean data to the Service layer
        const updatedUser = await userService.updateProfile(req.user!.userId, validatedData);
        // 3. Respond
        res.json({ user: updatedUser });
    } catch (error: any) {
        next(error);
    }
});

export default router;

