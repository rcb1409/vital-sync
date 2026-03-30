// -------------------------------------------------------
// Express Application Entry Point
// -------------------------------------------------------
// Sets up Express with middleware, mounts routes, and
// starts the server. This is the file that runs when
// you do `npm run dev`.
// -------------------------------------------------------

import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import workoutRoutes from './routes/workout.routes'

const app = express();

// --------------- Middleware ---------------
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://vitalsync.yourdomain.com'
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// --------------- Health Check ---------------
app.get('/api/health', async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    // Check Redis connection
    await redis.ping();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        cache: 'connected',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --------------- Routes ---------------
import authRoutes from './routes/auth.routes';
import exerciseRoutes from './routes/exercise.routes';
import nutritionRoutes from './routes/nutrition.routes';
import metricsRoutes from './routes/metrics.routes'; // <-- ADD THIS

app.use('/api/auth', authRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/metrics', metricsRoutes); // <-- ADD THIS
// More routes will be added as we build each feature

// --------------- Error Handler ---------------
// Must be registered LAST — catches errors from all routes
app.use(errorHandler);

// --------------- Start Server ---------------
const PORT = parseInt(env.PORT, 10);

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🏥 VitalSync API Server           ║
  ║   Port: ${PORT}                        ║
  ║   Env:  ${env.NODE_ENV.padEnd(26)}║
  ╚══════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received. Shutting down...');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});

export default app;
