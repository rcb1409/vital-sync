// -------------------------------------------------------
// Insights Routes
// -------------------------------------------------------
// CRUD for proactive_insights — the AI-generated insight
// cards displayed at the top of the dashboard.
//
// GET   /api/insights         → fetch unread/undismissed insights
// GET   /api/insights/count   → unread count (for notification badge)
// PATCH /api/insights/:id/read    → mark a single insight as read
// PATCH /api/insights/:id/dismiss → dismiss a single insight
// -------------------------------------------------------

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../config/database';

const router = Router();

// All insight routes require authentication
router.use(authenticate);

// ──────────────────────────────────────────────────────────────
// GET /api/insights
// Returns all undismissed insights for the current user,
// newest first. The dashboard uses this to render InsightCards.
// ──────────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const insights = await prisma.proactiveInsight.findMany({
      where: {
        userId:      req.user!.userId,
        isDismissed: false,         // never show dismissed insights again
      },
      orderBy: { createdAt: 'desc' },
      take: 10,                     // cap at 10 so the dashboard doesn't get flooded
    });
    res.json(insights);
  })
);

// ──────────────────────────────────────────────────────────────
// GET /api/insights/count
// Returns the count of unread insights.
// Used by the dashboard header to show a notification badge.
// ──────────────────────────────────────────────────────────────
router.get(
  '/count',
  asyncHandler(async (req, res) => {
    const count = await prisma.proactiveInsight.count({
      where: {
        userId:      req.user!.userId,
        isRead:      false,
        isDismissed: false,
      },
    });
    res.json({ count });
  })
);

// ──────────────────────────────────────────────────────────────
// PATCH /api/insights/:id/read
// Marks a specific insight as read (user opened / viewed it).
// ──────────────────────────────────────────────────────────────
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const insight = await prisma.proactiveInsight.updateMany({
      where: {
        id:     String(req.params.id),
        userId: req.user!.userId,   // ensures users can only mark their own insights
      },
      data: { isRead: true },
    });
    res.json({ updated: insight.count });
  })
);

// ──────────────────────────────────────────────────────────────
// PATCH /api/insights/:id/dismiss
// Dismisses an insight — it will no longer appear on the dashboard.
// Also marks it as read if it wasn't already.
// ──────────────────────────────────────────────────────────────
router.patch(
  '/:id/dismiss',
  asyncHandler(async (req, res) => {
    const insight = await prisma.proactiveInsight.updateMany({
      where: {
        id:     String(req.params.id),
        userId: req.user!.userId,
      },
      data: {
        isDismissed: true,
        isRead:      true,          // reading is implied by dismissing
      },
    });
    res.json({ updated: insight.count });
  })
);

export default router;
