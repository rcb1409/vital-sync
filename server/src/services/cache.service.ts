import { redis } from '../config/redis';

export const cacheService = {
  /**
   * Helper for cache-aside pattern
   * @param key Redis key
   * @param ttlSeconds Time to live in seconds
   * @param fetcher Function that fetches from DB on cache miss
   */
  async cacheAside<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    
    const fresh = await fetcher();
    
    // Only cache if there's actually data
    if (fresh !== null && fresh !== undefined) {
      await redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
    }
    
    return fresh;
  },

  /**
   * Clears specific cached entities for a user (Granular Invalidation)
   * Example tags: 'weight', 'streaks', 'ctx'
   */
  async invalidateSpecific(userId: string, tags: string[]): Promise<void> {
    for (const tag of tags) {
      // Bounded wildcard scan matching keys like `metrics:user123:weight:7d`
      const pattern = `*${userId}*${tag}*`;
      const keys = await this.scanKeys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  },

  /**
   * Uses SCAN instead of KEYS for safer production pattern matching
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [newCursor, scannedKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      keys.push(...scannedKeys);
    } while (cursor !== '0');
    
    return keys;
  }
};