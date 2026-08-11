// -------------------------------------------------------
// Express Application Entry Point
// -------------------------------------------------------
// Sets up Express with middleware, mounts routes, and
// starts the server. This is the file that runs when
// you do `npm run dev`.
// -------------------------------------------------------

// OTEL instrumentation MUST be imported first so the Langfuse
// span processor is registered before any tracing code runs.
import './config/instrumentation';

import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { authenticate } from './middleware/authenticate';
import { createSleepRecoveryWorker } from './workers/sleepRecovery.worker';
import aiRoutes from './routes/ai.routes';
import userRoutes from './routes/user.routes';

const app = express();

// --------------- Middleware ---------------
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://vitalsync.ravibollepalli.me'
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' })); // 10mb to support base64 food photos

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
import nutritionRoutes from './routes/nutrition.routes';
import metricsRoutes from './routes/metrics.routes';
import googleHealthRoutes from './routes/googleHealth.routes';
import insightsRoutes from './routes/insights.routes';

app.use('/api/auth', authRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/google-health', googleHealthRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/users', userRoutes);


// --------------- Error Handler ---------------
// Must be registered LAST — catches errors from all routes
app.use(errorHandler);

// --------------- Start Server ---------------
const PORT = parseInt(env.PORT, 10);

async function startServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  // Apply auth middleware separately to avoid Apollo/Express dual-types conflict
  app.use('/graphql', authenticate as any);
  app.use(
    '/graphql',
    expressMiddleware(server as any, {
      context: async ({ req }: any) => ({ user: req.user }),
    }) as any
  );

  app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   🏥 VitalSync API Server           ║
  ║   Port: ${PORT}                        ║
  ║   Env:  ${env.NODE_ENV.padEnd(26)}║
  ╚══════════════════════════════════════╝
    `);
    console.log(`🚀 GraphQL ready at http://localhost:${PORT}/graphql`);
  });

  // ── Background Workers ────────────────────────────────────────────────────
  // The sleep recovery worker watches the job queue and processes recovery
  // jobs (fetch HRV/RHR → calculate scores → generate insight → adjust goals).
  // It must start AFTER the server is listening so all services are ready.
  const sleepWorker = createSleepRecoveryWorker();
  console.log('⚙️  Sleep recovery worker started');

  return sleepWorker;
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received. Shutting down...');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
export default app;
