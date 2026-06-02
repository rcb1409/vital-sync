// server/src/routes/ai.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { aiService } from '../services/ai.service';

const router = Router();

// ==========================================
// POST /api/ai/chat (Non-streaming, kept for backwards compatibility)
// ==========================================
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

// ==========================================
// POST /api/ai/chat/stream (SSE Streaming)
// Streams the AI response token-by-token with status indicators.
//
// SSE event types:
//   - "status":  Tool execution indicators (e.g., "Fetching workout history...")
//   - "chunk":   Text chunk from the AI response (append to message)
//   - "done":    Stream complete
//   - "error":   Error occurred
// ==========================================
router.post('/chat/stream', authenticate, async (req, res) => {
    const { message, history, sessionId } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    try {
        await aiService.chatWithCoachStream(
            req.user!.userId,
            message,
            history || [],
            // onChunk: stream text tokens to the client
            (text: string) => {
                res.write(`event: chunk\ndata: ${JSON.stringify({ text })}\n\n`);
            },
            // onStatus: stream status updates (tool execution indicators)
            (status: string) => {
                res.write(`event: status\ndata: ${JSON.stringify({ status })}\n\n`);
            },
            sessionId
        );

        // Signal completion
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
    } catch (error) {
        console.error('SSE stream error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        res.end();
    }
});

export default router;
