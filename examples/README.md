# PushEnv Examples

This directory contains comprehensive examples showing different ways to use PushEnv.

## Examples

### 1. Export Pattern (Recommended) ⭐
**File:** `export-pattern.ts`

The recommended pattern for production applications. Shows how to:
- Create a central `config/env.ts` file
- Export the validated env object
- Import and use it throughout your application
- Get real coerced values (numbers, booleans, etc.)
- Achieve full type safety everywhere

```typescript
// config/env.ts
export const env = validateEnv({ schema });

// server.ts
import { env } from './config/env';
app.listen(env.PORT); // number, not string!
```

### 2. Basic Usage
**File:** `basic-usage.ts` (coming soon)

Simple examples for getting started:
- Loading .env files
- Basic validation
- Using separate functions

### 3. Advanced Patterns
**File:** `advanced-patterns.ts` (coming soon)

Advanced use cases:
- Multiple environment files
- Conditional validation
- Custom transformations
- Testing strategies

## Quick Start

1. **Install PushEnv:**
   ```bash
   npm install pushenv
   ```

2. **Copy the pattern you want:**
   ```bash
   # Copy export pattern to your project
   cp examples/export-pattern.ts src/config/env.ts
   ```

3. **Customize the schema:**
   Edit the schema to match your environment variables.

4. **Import and use:**
   ```typescript
   import { env } from './config/env';
   console.log(env.PORT); // ✓ Fully typed!
   ```

## Running Examples

These examples are TypeScript files meant to be copied and adapted to your project. They demonstrate patterns and best practices rather than being runnable scripts.

To use them:
1. Read through the example
2. Copy the pattern to your project
3. Customize to your needs

## Questions?

Check the main [README](../README.md) for full documentation.

