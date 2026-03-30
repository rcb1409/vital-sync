// -------------------------------------------------------
// Redis Client
// -------------------------------------------------------
// Single Redis connection shared across the app.
// Used for: refresh token storage, dashboard caching.
// -------------------------------------------------------

import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});
