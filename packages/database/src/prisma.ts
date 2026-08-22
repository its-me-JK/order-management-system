/**
 * Infrastructure-only Prisma access for composition roots and persistence
 * adapters. Domain and application layers must depend on their own ports.
 */
export { createPrismaDatabaseRuntime, getPrismaClient } from './prisma-database.runtime';
export type { Prisma, PrismaClient } from './generated/prisma/client';
