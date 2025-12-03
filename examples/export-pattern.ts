/**
 * Example: Export Pattern for Type-Safe Environment Variables
 * 
 * This is the recommended pattern for using pushenv in production applications.
 * Create a central config file that exports the validated env object.
 */

// ============================================================================
// config/env.ts - Create once, import everywhere
// ============================================================================

import { validateEnv, z } from 'pushenv';

export const env = validateEnv({
  schema: z.object({
    // Server Configuration
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('localhost'),

    // Database
    DATABASE_URL: z.string().url(),
    DB_POOL_SIZE: z.coerce.number().default(10),
    DB_TIMEOUT: z.coerce.number().default(5000),

    // Cache
    REDIS_URL: z.string().url().optional(),
    CACHE_TTL: z.coerce.number().default(3600),
    ENABLE_CACHE: z.coerce.boolean().default(false),

    // Authentication
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('7d'),
    SESSION_SECRET: z.string().min(32),

    // External APIs
    API_KEY: z.string().optional(),
    WEBHOOK_URL: z.string().url().optional(),

    // Logging
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  }),
  path: '.env',
  generateTypes: process.env.NODE_ENV !== 'production', // Only generate in dev
  debug: process.env.DEBUG === 'true',
});

// Optional: Export type for use in dependency injection or testing
export type Env = typeof env;

// ============================================================================
// server.ts - Use in your server
// ============================================================================

import { env } from './config/env';
import express from 'express';

const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: env.NODE_ENV,
    version: '1.0.0',
  });
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`✓ Server running on http://${env.HOST}:${env.PORT}`);
  console.log(`✓ Environment: ${env.NODE_ENV}`);
  console.log(`✓ Log level: ${env.LOG_LEVEL}`);
});

// ============================================================================
// database.ts - Use in your database connection
// ============================================================================

import { env } from './config/env';

export function connectDatabase() {
  const config = {
    url: env.DATABASE_URL,
    pool: {
      min: 2,
      max: env.DB_POOL_SIZE,
    },
    timeout: env.DB_TIMEOUT,
    logging: env.LOG_LEVEL === 'debug',
  };

  console.log(`✓ Connecting to database with pool size: ${env.DB_POOL_SIZE}`);
  // ... your database connection logic
}

// ============================================================================
// cache.ts - Use in your cache layer
// ============================================================================

import { env } from './config/env';

export function initCache() {
  if (!env.ENABLE_CACHE) {
    console.log('ℹ Cache disabled');
    return null;
  }

  if (!env.REDIS_URL) {
    console.warn('⚠️  Cache enabled but REDIS_URL not provided, falling back to memory cache');
    return null;
  }

  console.log(`✓ Initializing Redis cache with TTL: ${env.CACHE_TTL}s`);
  // ... your Redis connection logic
}

// ============================================================================
// auth.ts - Use in your authentication logic
// ============================================================================

import { env } from './config/env';
import jwt from 'jsonwebtoken';

export function generateToken(payload: object): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET);
}

// ============================================================================
// Benefits of this pattern:
// ============================================================================

/**
 * ✅ Real coerced values
 *    - env.PORT is actually a number, not a string
 *    - env.ENABLE_CACHE is a boolean, not "true" or "false"
 * 
 * ✅ Single source of truth
 *    - Validate once at startup
 *    - Import everywhere with confidence
 * 
 * ✅ Full type safety
 *    - TypeScript autocomplete everywhere
 *    - Catch typos at compile time
 * 
 * ✅ Fails fast
 *    - App crashes at startup if config is invalid
 *    - Not during a customer request in production!
 * 
 * ✅ Easy to test
 *    - Mock the env object in tests
 *    - No need to modify process.env
 * 
 * ✅ Self-documenting
 *    - Schema shows all required/optional vars
 *    - Types show expected data types
 */

// ============================================================================
// Testing example
// ============================================================================

import { env, type Env } from './config/env';

// In tests, you can create a mock env object
export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    ...overrides,
  };
}

// Usage in test
const testEnv = createMockEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test_db',
});

