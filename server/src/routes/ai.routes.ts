// server/src/routes/ai.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { aiService } from '../services/ai.service';

const router = Router();

// We use the `authenticate` middleware to guarantee that whoever is
// calling this route is legally logged in. It gives us `req.user.userId`.
router.post('/chat', authenticate, async (req, res, next) => {
    try {
        const { message, history } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Send the user's ID and their message deep into the Context Engine
        const aiResponseText = await aiService.chatWithCoach(req.user.userId, message, history);

        // Send the AI's reply back to the React app
        res.json({ reply: aiResponseText });

    } catch (error) {
        // If Google Gemini crashes or rate limits, the global error handler catches it
        next(error);
    }
});

export default router;
