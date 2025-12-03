import { z } from "zod";
import chalk from "chalk";
import { config, type ConfigOptions } from "./config.js";
import { generateTypes, type GenerateTypesOptions } from "./generate-types.js";

export interface ValidateOptions {
  schema: z.ZodObject<any>;
  throwOnError?: boolean;  // throw or just log warnings (default: true)
  debug?: boolean;         // show debug info (default: false)
}

export interface ValidateResult {
  success: boolean;
  data?: any;
  errors?: ValidationError[];
}

export interface ValidationError {
  key: string;
  message: string;
  type: "missing" | "invalid" | "type_mismatch";
}

/**
 * Validate environment variables against a Zod schema
 * 
 * @param options - Validation options with Zod schema
 * @returns Validation result with errors if any
 * 
 * @example
 * ```typescript
 * import { validate, z } from 'pushenv';
 * 
 * validate({
 *   schema: z.object({
 *     PORT: z.string().regex(/^\d+$/),
 *     DATABASE_URL: z.string().url(),
 *     NODE_ENV: z.enum(["development", "production", "test"]),
 *   })
 * });
 * ```
 */
export function validate(options: ValidateOptions): ValidateResult {
  const { schema, throwOnError = true, debug = false } = options;

  if (debug) {
    console.log(chalk.gray("[pushenv] Starting environment validation..."));
  }

  try {
    // Parse process.env against the schema
    const result = schema.safeParse(process.env);

    if (result.success) {
      if (debug) {
        console.log(chalk.green("[pushenv] ✓ All environment variables are valid"));
      }
      return {
        success: true,
        data: result.data,
      };
    }

    // Validation failed - collect and format errors
    const errors: ValidationError[] = [];
    const zodErrors = result.error.errors;

    for (const error of zodErrors) {
      const key = error.path.join(".");
      const value = process.env[key];

      let errorType: ValidationError["type"];
      let message: string;

      if (error.code === "invalid_type" && error.received === "undefined") {
        errorType = "missing";
        message = `Missing required environment variable`;
      } else if (error.code === "invalid_enum_value") {
        errorType = "type_mismatch";
        const expected = (error as any).options?.join(", ") || "valid enum value";
        message = `Expected one of: ${expected}, received: ${value}`;
      } else if (error.code === "invalid_string" || error.code === "invalid_type") {
        errorType = "type_mismatch";
        message = error.message;
      } else {
        errorType = "invalid";
        message = error.message;
      }

      errors.push({ key, message, type: errorType });
    }

    // Format error messages
    console.error(chalk.red.bold("\n❌ Environment validation failed!\n"));
    
    const missingErrors = errors.filter(e => e.type === "missing");
    const typeErrors = errors.filter(e => e.type === "type_mismatch");
    const otherErrors = errors.filter(e => e.type === "invalid");

    if (missingErrors.length > 0) {
      console.error(chalk.yellow("Missing required variables:"));
      for (const error of missingErrors) {
        console.error(chalk.white(`  • ${chalk.cyan(error.key)}: ${error.message}`));
      }
      console.error();
    }

    if (typeErrors.length > 0) {
      console.error(chalk.yellow("Type/format mismatches:"));
      for (const error of typeErrors) {
        console.error(chalk.white(`  • ${chalk.cyan(error.key)}: ${error.message}`));
      }
      console.error();
    }

    if (otherErrors.length > 0) {
      console.error(chalk.yellow("Validation errors:"));
      for (const error of otherErrors) {
        console.error(chalk.white(`  • ${chalk.cyan(error.key)}: ${error.message}`));
      }
      console.error();
    }

    // Provide helpful suggestions
    console.error(chalk.gray("💡 Suggestions:"));
    console.error(chalk.gray("  1. Check your .env file for missing or incorrect values"));
    console.error(chalk.gray("  2. Create a .env.example file to document required variables"));
    console.error(chalk.gray("  3. Use pushenv.config() before validation to load .env files\n"));

    if (throwOnError) {
      const error = new Error(
        `Environment validation failed: ${errors.length} error(s) found`
      );
      (error as any).errors = errors;
      throw error;
    }

    return {
      success: false,
      errors,
    };

  } catch (error) {
    if (error instanceof Error && (error as any).errors) {
      // This is our validation error, re-throw it
      throw error;
    }

    // Unexpected error
    console.error(chalk.red("\n❌ Validation error:"), error);
    
    if (throwOnError) {
      throw error;
    }

    return {
      success: false,
      errors: [{
        key: "unknown",
        message: error instanceof Error ? error.message : String(error),
        type: "invalid",
      }],
    };
  }
}

/**
 * Validate environment variables and return only valid data (throws on error)
 * 
 * This is a convenience function that always throws on validation failure
 * and returns the typed, validated data.
 * 
 * @param schema - Zod schema to validate against
 * @returns Typed and validated environment data
 * 
 * @example
 * ```typescript
 * import { validateOrThrow, z } from 'pushenv';
 * 
 * const env = validateOrThrow(z.object({
 *   PORT: z.coerce.number(),
 *   DATABASE_URL: z.string().url(),
 * }));
 * 
 * env.PORT;        // number ✓ Fully typed!
 * env.DATABASE_URL // string ✓ Validated URL!
 * ```
 */
export function validateOrThrow<T extends z.ZodObject<any>>(
  schema: T
): z.infer<T> {
  const result = validate({ schema, throwOnError: true });
  return result.data!;
}

export interface ValidateEnvOptions<T extends z.ZodObject<any>> {
  schema: T;
  path?: string;              // .env file path (default: ".env")
  override?: boolean;         // override existing process.env (default: false)
  debug?: boolean;            // log debug info (default: false)
  generateTypes?: boolean | Partial<GenerateTypesOptions>; // Auto-generate types (default: true in development)
}

/**
 * Load, validate, and optionally generate types for environment variables in one call
 * 
 * This is a convenience function that combines config(), validateOrThrow(), and generateTypes()
 * into a single unified API. Perfect for TypeScript users who want full type safety.
 * 
 * @param options - Validation options with Zod schema
 * @returns Typed and validated environment data
 * 
 * @example
 * ```typescript
 * import { validateEnv, z } from 'pushenv';
 * 
 * const env = validateEnv({
 *   schema: z.object({
 *     PORT: z.coerce.number(),
 *     DATABASE_URL: z.string().url(),
 *     NODE_ENV: z.enum(['development', 'production', 'test']),
 *   }),
 *   generateTypes: true,  // optional, defaults to true in dev
 * });
 * 
 * env.PORT;        // number ✓ Fully typed!
 * env.DATABASE_URL // string ✓ Validated URL!
 * env.NODE_ENV     // 'development' | 'production' | 'test' ✓
 * ```
 */
export function validateEnv<T extends z.ZodObject<any>>(
  options: ValidateEnvOptions<T>
): z.infer<T> {
  const {
    schema,
    path = ".env",
    override = false,
    debug = false,
    generateTypes: shouldGenerateTypes = true, // default to true
  } = options;

  // 1. Load .env file
  const configResult = config({
    path,
    override,
    debug,
  });

  if (configResult.error && debug) {
    console.warn(chalk.yellow(`[pushenv] Warning: ${configResult.error.message}`));
    console.warn(chalk.gray("[pushenv] Continuing with existing environment variables..."));
  }

  // 2. Validate environment variables
  const env = validateOrThrow(schema);

  // 3. Generate TypeScript types if enabled
  if (shouldGenerateTypes) {
    const typeGenOptions: Partial<GenerateTypesOptions> = 
      typeof shouldGenerateTypes === 'object' 
        ? shouldGenerateTypes 
        : {};

    generateTypes({
      schema,
      silent: !debug,
      ...typeGenOptions,
    });
  }

  return env;
}

