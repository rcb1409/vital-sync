// -------------------------------------------------------
// Job Queue Configuration (BullMQ)
// -------------------------------------------------------
// BullMQ uses Redis as a backing store for jobs.
//
// Think of it like this:
//   - A Queue is a named to-do list stored in Redis.
//   - You "add" a job to the list (optionally with a delay).
//   - A Worker watches the list and runs jobs when they're due.
//
// We use a SEPARATE Redis connection for BullMQ because
// BullMQ requires maxRetriesPerRequest: null (it manages
// retries itself), whereas the app's main Redis client uses
// maxRetriesPerRequest: 3. Two connections, same Redis server.
// -------------------------------------------------------

import { Queue, QueueEvents } from 'bullmq';
import { env } from './env';

// BullMQ connection config — MUST have maxRetriesPerRequest: null
const bullMQConnection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379'),
};

// ── Queue Definitions ──────────────────────────────────────────────────────────

/**
 * sleepRecoveryQueue
 *
 * Jobs added here are processed by the sleepRecovery worker.
 * Two job types:
 *   - 'fetch-recovery': triggered 20 min after a sleep webhook,
 *                       fetches HRV + RHR, calculates scores, generates insight.
 */
export const sleepRecoveryQueue = new Queue('sleep-recovery', {
  connection: bullMQConnection,
  defaultJobOptions: {
    removeOnComplete: 100,  // keep last 100 completed jobs for debugging
    removeOnFail: 500,      // keep last 500 failed jobs for inspection
    attempts: 3,            // retry up to 3 times if a job fails
    backoff: {
      type: 'exponential',
      delay: 60_000,        // wait 1 min, then 2 min, then 4 min between retries
    },
  },
});

// QueueEvents lets you listen to job lifecycle events (optional, useful for logging)
export const sleepRecoveryQueueEvents = new QueueEvents('sleep-recovery', {
  connection: bullMQConnection,
});

sleepRecoveryQueueEvents.on('completed', ({ jobId }) => {
  console.log(`✅ Sleep recovery job ${jobId} completed`);
});

sleepRecoveryQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`❌ Sleep recovery job ${jobId} failed: ${failedReason}`);
});

export { bullMQConnection };
