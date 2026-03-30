// -------------------------------------------------------
// Auth Routes
// -------------------------------------------------------
// REST endpoints for authentication:
//   POST /api/auth/register  → Create account, return tokens
//   POST /api/auth/login     → Verify creds, return tokens
//   POST /api/auth/refresh   → Rotate refresh token
//   POST /api/auth/logout    → Revoke all refresh tokens
//   GET  /api/auth/me        → Get current user profile
//   PUT  /api/auth/me        → Update profile + goals
//
// Routes are thin — they validate input, call the service,
// and return the response. Business logic lives in the
// auth service.
// -------------------------------------------------------

import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { authenticate } from '../middleware/authenticate';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
} from '../validators/auth.validator';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// =====================================================
// POST /api/auth/register
// =====================================================
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);

    res.status(201).json({
      message: 'Account created successfully',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  })
);

// =====================================================
// POST /api/auth/login
// =====================================================
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);

    res.json({
      message: 'Login successful',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  })
);

// =====================================================
// POST /api/auth/refresh
// =====================================================
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    const result = await authService.refresh(refreshToken);

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  })
);

// =====================================================
// POST /api/auth/logout
// =====================================================
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout(req.user!.userId);
    res.json({ message: 'Logged out successfully' });
  })
);

// =====================================================
// GET /api/auth/me
// =====================================================
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await authService.getProfile(req.user!.userId);
    res.json({ user });
  })
);

// =====================================================
// PUT /api/auth/me
// =====================================================
router.put(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const user = await authService.updateProfile(req.user!.userId, input);
    res.json({ user });
  })
);

export default router;
