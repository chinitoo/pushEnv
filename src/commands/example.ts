import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  isProjectInitialized,
  readProjectConfig,
  getKeyEntry,
  getEnvPathForStage,
  getConfiguredStages,
} from "../utils/config.js";
import {
  deriveKeyFromPassphrase,
  decrypt,
} from "../utils/crypto.js";
import { downloadFromR2, existsInR2 } from "../utils/r2-client.js";
import { parseEnvContent } from "../utils/env-parser.js";

/**
 * Generate example value based on key name
 */
function generateExampleValue(key: string): string {
  const keyLower = key.toLowerCase();
  
  // Common patterns
  if (keyLower.includes("url")) {
    return "https://example.com";
  }
  if (keyLower.includes("database") || keyLower.includes("db")) {
    if (keyLower.includes("url")) {
      return "postgresql://user:password@localhost:5432/dbname";
    }
    return "your-database-value";
  }
  if (keyLower.includes("api") && keyLower.includes("key")) {
    return "your-api-key-here";
  }
  if (keyLower.includes("secret")) {
    return "your-secret-here";
  }
  if (keyLower.includes("password")) {
    return "your-password-here";
  }
  if (keyLower.includes("token")) {
    return "your-token-here";
  }
  if (keyLower.includes("port")) {
    return "3000";
  }
  if (keyLower.includes("host")) {
    return "localhost";
  }
  if (keyLower.includes("email")) {
    return "example@example.com";
  }
  
  // Default
  return "your-value-here";
}

/**
 * Convert env content to example format (replace values with placeholders)
 */
function convertToExample(content: string): string {
  const parsed = parseEnvContent(content);
  const lines: string[] = [];
  
  // Process each key-value pair
  for (const key of parsed.keys) {
    const value = parsed.env[key];
    if (!value) continue; // Skip if value is undefined
    
    const exampleValue = generateExampleValue(key);
    
    // Preserve quotes if original had them
    let formattedValue = exampleValue;
    if (value.startsWith('"') && value.endsWith('"')) {
      formattedValue = `"${exampleValue}"`;
    } else if (value.startsWith("'") && value.endsWith("'")) {
      formattedValue = `'${exampleValue}'`;
    }
    
    lines.push(`${key}=${formattedValue}`);
  }
  
  return lines.join("\n");
}

export async function exampleCommand(stage: string, outputPath?: string): Promise<void> {
  console.log(chalk.cyan(`\n🔐 pushenv example - Generate example .env file (${stage})\n`));

  // Check if project is initialized
  if (!isProjectInitialized()) {
    console.log(chalk.red("✗ Project not initialized."));
    console.log(chalk.gray("  Run 'pushenv init' first to set up your project."));
    process.exit(1);
  }

  const config = readProjectConfig()!;

  // Check if stage is configured
  const envPathForStage = getEnvPathForStage(config, stage);
  if (!envPathForStage) {
    const configuredStages = getConfiguredStages(config);
    console.log(chalk.red(`✗ Stage '${stage}' is not configured for this project.`));
    console.log(chalk.gray(`  Configured stages: ${configuredStages.join(", ")}`));
    console.log(chalk.gray(`  Run 'pushenv init' to reconfigure stages.`));
    process.exit(1);
  }

  console.log(chalk.gray(`Project: ${config.projectId}`));
  console.log(chalk.gray(`Stage: ${stage}\n`));

  // Check if remote exists
  console.log(chalk.gray("Checking remote..."));
  const remoteExists = await existsInR2(config.projectId, stage);
  if (!remoteExists) {
    console.log(chalk.red(`\n✗ No remote .env found for stage '${stage}'.`));
    console.log(chalk.gray(`  Run 'pushenv push --stage ${stage}' to upload it first.`));
    process.exit(1);
  }
  console.log(chalk.green("✓ Remote found"));

  // Download and decrypt remote
  console.log(chalk.gray("Downloading and decrypting remote..."));
  let remoteContent: string;

  try {
    const encryptedData = await downloadFromR2(config.projectId, stage);

    // Extract salt and decrypt
    const firstColon = encryptedData.indexOf(":");
    if (firstColon === -1) {
      console.log(chalk.red("\n✗ Invalid encrypted data format."));
      process.exit(1);
    }

    const saltHex = encryptedData.slice(0, firstColon);
    const actualEncryptedData = encryptedData.slice(firstColon + 1);
    const salt = Buffer.from(saltHex, "hex");

    // Get key for decryption
    const keyEntry = getKeyEntry(config.projectId);
    let keyBuffer: Buffer;

    if (keyEntry) {
      keyBuffer = Buffer.from(keyEntry.key, "base64");
    } else {
      // Need passphrase
      const response = await inquirer.prompt<{ passphrase: string }>([
        {
          type: "password",
          name: "passphrase",
          message: "Enter the passphrase:",
          mask: "*",
        },
      ]);

      const { key } = deriveKeyFromPassphrase(response.passphrase, salt);
      keyBuffer = key;
    }

    const decrypted = decrypt(actualEncryptedData, keyBuffer);
    remoteContent = decrypted;
    console.log(chalk.green("✓ Remote decrypted"));
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unsupported state") || error.message.includes("auth")) {
        console.log(chalk.red("\n✗ Decryption failed: Incorrect passphrase or key."));
      } else {
        console.log(chalk.red(`\n✗ Failed to decrypt remote: ${error.message}`));
      }
    }
    process.exit(1);
  }

  // Remove PushEnv header if present
  const lines = remoteContent.split("\n");
  let contentStart = 0;
  let foundPushEnvHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";
    if (line && !line.startsWith("#")) {
      contentStart = i;
      break;
    }
    if (line.includes("PushEnv") || line.includes("═")) {
      foundPushEnvHeader = true;
    }
  }

  if (foundPushEnvHeader) {
    for (let i = contentStart; i < lines.length; i++) {
      const line = lines[i]?.trim() || "";
      if (line && !line.startsWith("#")) {
        contentStart = i;
        break;
      }
    }
  }

  const envContent = lines.slice(contentStart).join("\n");

  // Convert to example format
  console.log(chalk.gray("Generating example file..."));
  const exampleContent = convertToExample(envContent);

  // Determine output path
  const defaultOutputPath = outputPath || `.env.${stage}.example`;
  const resolvedOutputPath = path.resolve(process.cwd(), defaultOutputPath);

  // Check if file already exists
  if (fs.existsSync(resolvedOutputPath)) {
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: "confirm",
        name: "overwrite",
        message: `${defaultOutputPath} already exists. Overwrite?`,
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.gray("\nExample file generation cancelled."));
      return;
    }
  }

  // Create header
  const now = new Date();
  const header = `# ════════════════════════════════════════
# PushEnv Example Environment File
# Stage: ${stage.toUpperCase()}
# Generated: ${now.toISOString()}
# ════════════════════════════════════════
# This is an EXAMPLE file with placeholder values.
# Safe to commit to version control.
# Replace values with your actual secrets.
#
`;

  // Write example file
  const exampleFileContent = header + exampleContent;
  const outputDir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(resolvedOutputPath, exampleFileContent, "utf8");

  const parsed = parseEnvContent(envContent);
  console.log(chalk.green(`✓ Generated example file with ${parsed.count} variables`));
  console.log(chalk.green(`  File: ${defaultOutputPath}`));
  console.log();
  console.log(chalk.cyan("═".repeat(60)));
  console.log(chalk.green.bold("\n🎉 Example file created!\n"));
  console.log(chalk.white(`This file is safe to commit to version control.`));
  console.log(chalk.white(`It shows the required environment variables with placeholder values.`));
  console.log(chalk.cyan("═".repeat(60)));
  console.log();
}

