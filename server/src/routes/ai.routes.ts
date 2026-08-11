import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { aiService } from '../services/ai.service';

const router = Router();

// POST /api/ai/chat
router.post('/chat', authenticate, async (req, res, next) => {
    try {
        const { message, history, sessionId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const { reply } = await aiService.chatWithCoach(req.user!.userId, message, history, sessionId);
        res.json({ reply });
    } catch (error) {
        next(error);
    }
});

export default router;
