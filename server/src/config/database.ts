// -------------------------------------------------------
// Prisma Client Singleton
// -------------------------------------------------------
// Creates a single Prisma client instance shared across
// the entire app. In development, we store it on
// globalThis to prevent multiple instances during
// hot-module reloading.
// -------------------------------------------------------

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
