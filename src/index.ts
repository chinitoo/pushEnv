/**
 * PushEnv - Secure .env management with validation
 * 
 * Use as a library (like dotenv) or as a CLI tool for team sync
 * 
 * @example Library usage (drop-in dotenv replacement)
 * ```typescript
 * import pushenv, { z } from 'pushenv';
 * 
 * // Load .env file
 * pushenv.config();
 * 
 * // Load with options
 * pushenv.config({ path: '.env.production', override: true });
 * 
 * // Validate with Zod schema (z is re-exported from pushenv!)
 * pushenv.validate({
 *   schema: z.object({
 *     PORT: z.string().regex(/^\d+$/),
 *     DATABASE_URL: z.string().url(),
 *   })
 * });
 * ```
 * 
 * @example Named imports (no separate zod install needed!)
 * ```typescript
 * import { validateEnv, z } from 'pushenv';
 * 
 * // One call: load + validate + generate types!
 * const env = validateEnv({
 *   schema: z.object({
 *     PORT: z.coerce.number(),
 *     DATABASE_URL: z.string().url(),
 *   })
 * });
 * 
 * env.PORT;        // number ✓ Fully typed!
 * env.DATABASE_URL // string ✓ Validated URL!
 * ```
 * 
 * @example CLI usage
 * ```bash
 * # Install globally for CLI
 * npm install -g pushenv
 * 
 * # Initialize project
 * pushenv init
 * 
 * # Push encrypted .env to cloud
 * pushenv push --stage production
 * 
 * # Pull encrypted .env from cloud
 * pushenv pull --stage production
 * 
 * # Run command with env in memory (no .env file)
 * pushenv run --stage production "npm start"
 * ```
 */

// Import functions
import { config, type ConfigOptions, type ConfigResult } from "./lib/config.js";
import { 
  validate, 
  validateOrThrow,
  validateEnv,
  type ValidateOptions, 
  type ValidateResult,
  type ValidationError,
  type ValidateEnvOptions
} from "./lib/validate.js";
import {
  generateTypes,
  generateTypesFromSchema,
  type GenerateTypesOptions,
  type GenerateTypesResult
} from "./lib/generate-types.js";

// Re-export Zod so users don't need to install it separately
export { z } from "zod";

// Named exports
export { 
  config, 
  validate, 
  validateOrThrow,
  validateEnv,
  generateTypes,
  generateTypesFromSchema,
  type ConfigOptions,
  type ConfigResult,
  type ValidateOptions,
  type ValidateResult,
  type ValidationError,
  type ValidateEnvOptions,
  type GenerateTypesOptions,
  type GenerateTypesResult
};

// Default export with all functions (supports pushenv.config() style)
export default {
  config,
  validate,
  validateOrThrow,
  validateEnv,
  generateTypes,
  generateTypesFromSchema,
};

