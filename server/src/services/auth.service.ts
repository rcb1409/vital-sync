// -------------------------------------------------------
// Auth Service
// -------------------------------------------------------
// Contains all auth business logic:
//   - Password hashing (bcrypt, 12 rounds)
//   - JWT access token generation (15 min)
//   - Refresh token generation (7 days, stored in Redis)
//   - Refresh token rotation (single-use tokens)
//   - Token validation
//
// The route layer calls this service — routes are thin,
// services contain the logic.
// -------------------------------------------------------

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import type { RegisterInput, LoginInput, UpdateProfileInput } from '../validators/auth.validator';

// =====================================================
// Types
// =====================================================
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface JwtPayload {
  userId: string;
  email: string;
}

// =====================================================
// Password Hashing
// =====================================================
const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// =====================================================
// Token Generation
// =====================================================

/**
 * Generate a JWT access token (short-lived, stateless).
 * The frontend sends this in the Authorization header.
 */
function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: 15 * 60, // 15 minutes in seconds
  });
}

/**
 * Generate a refresh token (long-lived, stored in Redis).
 * Used to get a new access token when the current one expires.
 *
 * Refresh tokens are single-use: when you use one to refresh,
 * the old one is deleted from Redis and a new one is created.
 * This is called "refresh token rotation" — it limits the
 * damage if a refresh token is stolen.
 */
async function generateRefreshToken(userId: string): Promise<string> {
  const tokenId = uuidv4();
  const token = jwt.sign({ userId, tokenId }, env.JWT_REFRESH_SECRET, {
    expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  // Store in Redis with a 7-day TTL
  // Key: refresh:{tokenId}  Value: userId
  const ttlSeconds = 7 * 24 * 60 * 60; // 7 days
  await redis.set(`refresh:${tokenId}`, userId, 'EX', ttlSeconds);

  return token;
}

/**
 * Verify an access token and return the payload.
 */
function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
  } catch {
    throw new AppError(401, 'Invalid or expired access token');
  }
}

/**
 * Verify a refresh token:
 *   1. Decode the JWT
 *   2. Check if the tokenId exists in Redis (not already used)
 *   3. Delete the old tokenId from Redis (single-use)
 *   4. Return the userId
 */
async function verifyRefreshToken(token: string): Promise<string> {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      userId: string;
      tokenId: string;
    };

    // Check Redis — is this token still valid?
    const storedUserId = await redis.get(`refresh:${decoded.tokenId}`);
    if (!storedUserId) {
      throw new AppError(401, 'Refresh token has been revoked or already used');
    }

    // Delete it — each refresh token can only be used once
    await redis.del(`refresh:${decoded.tokenId}`);

    return decoded.userId;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'Invalid or expired refresh token');
  }
}

/**
 * Revoke all refresh tokens for a user (used on logout).
 * Scans Redis for all keys matching refresh:* for this user.
 */
async function revokeAllRefreshTokens(userId: string): Promise<void> {
  // Scan for all refresh tokens (in production you'd track token IDs per user)
  // For now, this is a simplified approach
  const keys = await redis.keys('refresh:*');
  for (const key of keys) {
    const storedUserId = await redis.get(key);
    if (storedUserId === userId) {
      await redis.del(key);
    }
  }
}

// =====================================================
// Auth Operations
// =====================================================

async function register(input: RegisterInput) {
  // Check if email already exists
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw new AppError(409, 'Email already registered');
  }

  // Hash password and create user
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      goals: {
        calorie_target: 2000,
        protein_target: 150,
        target_weight: 75,
        training_days_per_week: 4,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      goals: true,
      createdAt: true,
    },
  });

  // Generate token pair
  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = await generateRefreshToken(user.id);

  return { user, accessToken, refreshToken };
}

async function login(input: LoginInput) {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (!user) {
    throw new AppError(401, 'Invalid email or password');
  }

  // Verify password
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid email or password');
  }

  // Generate token pair
  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = await generateRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      goals: user.goals,
    },
    accessToken,
    refreshToken,
  };
}

async function refresh(oldRefreshToken: string) {
  // Verify and consume the old refresh token
  const userId = await verifyRefreshToken(oldRefreshToken);

  // Get user info for new access token
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, goals: true },
  });
  if (!user) {
    throw new AppError(401, 'User not found');
  }

  // Generate fresh token pair
  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = await generateRefreshToken(user.id);

  return { user, accessToken, refreshToken };
}

async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      goals: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) {
    throw new AppError(404, 'User not found');
  }
  return user;
}

async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.goals && { goals: input.goals }),
    },
    select: {
      id: true,
      email: true,
      name: true,
      goals: true,
      updatedAt: true,
    },
  });
  return user;
}

async function logout(userId: string) {
  await revokeAllRefreshTokens(userId);
}

// =====================================================
// Export
// =====================================================
export const authService = {
  register,
  login,
  refresh,
  getProfile,
  updateProfile,
  logout,
  verifyAccessToken,
};
