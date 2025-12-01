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
import {
  downloadFromR2,
  existsInR2,
  downloadVersionFromR2,
  readVersionMetadata,
} from "../utils/r2-client.js";
import { parseEnvContent } from "../utils/env-parser.js";

export interface DiffResult {
  added: Array<{ key: string; value: string }>;
  removed: Array<{ key: string; value: string }>;
  changed: Array<{ key: string; localValue: string; remoteValue: string }>;
  unchanged: number;
}

/**
 * Extract stage from PushEnv header in file content
 * Returns null if no header found or stage cannot be determined
 */
function extractStageFromHeader(content: string): string | null {
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Look for: # Stage: PRODUCTION or # Stage: PRODUCTION ⚠️
    if (trimmed.startsWith("#") && trimmed.includes("Stage:")) {
      const match = trimmed.match(/#\s*Stage:\s*(\w+)/i);
      if (match && match[1]) {
        return match[1].toLowerCase();
      }
    }
    // Stop looking after we've passed the header section
    if (trimmed && !trimmed.startsWith("#") && !trimmed.includes("═")) {
      break;
    }
  }
  
  return null;
}

/**
 * Remove PushEnv header from content to get actual env variables
 */
function removePushEnvHeader(content: string): string {
  const lines = content.split("\n");
  let contentStart = 0;
  let foundPushEnvHeader = false;
  let headerEndIndex = -1;

  // Find PushEnv header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";
    
    // Check if this is part of PushEnv header
    if (line.includes("PushEnv") || (line.includes("═") && line.startsWith("#"))) {
      foundPushEnvHeader = true;
      headerEndIndex = i;
    }
    
    // If we found header, look for the end (empty line or separator)
    if (foundPushEnvHeader) {
      if (line === "" || (line.startsWith("#") && !line.includes("═") && !line.includes("PushEnv"))) {
        // Continue looking for end of header section
        continue;
      }
      if (line && !line.startsWith("#")) {
        // Found first non-comment line after header
        contentStart = i;
        break;
      }
    } else {
      // No header found yet, look for first non-comment line
      if (line && !line.startsWith("#")) {
        contentStart = i;
        break;
      }
    }
  }

  // If we found a header but didn't find content start, start after header
  if (foundPushEnvHeader && contentStart === 0 && headerEndIndex >= 0) {
    // Find first non-comment line after header
    for (let i = headerEndIndex + 1; i < lines.length; i++) {
      const line = lines[i]?.trim() || "";
      if (line && !line.startsWith("#")) {
        contentStart = i;
        break;
      }
    }
  }

  return lines.slice(contentStart).join("\n");
}

/**
 * Compare two parsed env objects and return differences
 */
function compareEnvs(
  local: Record<string, string>,
  remote: Record<string, string>
): DiffResult {
  const added: Array<{ key: string; value: string }> = [];
  const removed: Array<{ key: string; value: string }> = [];
  const changed: Array<{ key: string; localValue: string; remoteValue: string }> = [];
  let unchanged = 0;

  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const key of allKeys) {
    const localValue = local[key];
    const remoteValue = remote[key];

    if (localValue === undefined && remoteValue !== undefined) {
      // Added in remote
      added.push({ key, value: remoteValue });
    } else if (localValue !== undefined && remoteValue === undefined) {
      // Removed from remote
      removed.push({ key, value: localValue });
    } else if (localValue !== remoteValue) {
      // Changed
      changed.push({
        key,
        localValue: localValue!,
        remoteValue: remoteValue!,
      });
    } else {
      // Unchanged
      unchanged++;
    }
  }

  return { added, removed, changed, unchanged };
}

export interface DiffOptions {
  version?: number | undefined;
}

export async function diffCommand(stage: string, options: DiffOptions = {}): Promise<void> {
  const versionLabel = options.version ? ` (version ${options.version})` : " (latest)";
  console.log(chalk.cyan(`\n🔐 pushenv diff - Compare local vs remote${versionLabel} (${stage})\n`));

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
  console.log(chalk.gray(`Stage: ${stage}`));
  console.log(chalk.gray(`Local file: ${envPathForStage}\n`));

  // Check if local file exists
  const localEnvPath = path.resolve(process.cwd(), envPathForStage);
  let localContent: string;
  let localStageFromHeader: string | null = null;

  if (!fs.existsSync(localEnvPath)) {
    console.log(chalk.red(`✗ Local .env file not found at ${envPathForStage}`));
    console.log(chalk.gray(`  Run 'pushenv pull --stage ${stage}' to download it first.`));
    process.exit(1);
  }

  // Read local file
  console.log(chalk.gray("Reading local .env file..."));
  localContent = fs.readFileSync(localEnvPath, "utf8");

  // Extract stage from header if present
  localStageFromHeader = extractStageFromHeader(localContent);

  // Verify stage matches
  if (localStageFromHeader && localStageFromHeader !== stage) {
    console.log(chalk.yellow("\n⚠️  WARNING: Stage mismatch detected!\n"));
    console.log(chalk.white(`  Command stage: ${chalk.bold(stage)}`));
    console.log(chalk.white(`  Local file stage: ${chalk.bold(localStageFromHeader)} (from header)`));
    console.log(chalk.white(`  File: ${envPathForStage}\n`));
    console.log(
      chalk.gray(
        "  This file appears to contain data from a different stage.\n" +
        "  Comparing against the wrong stage may give incorrect results.\n"
      )
    );

    const { continueAnyway } = await inquirer.prompt<{ continueAnyway: boolean }>([
      {
        type: "confirm",
        name: "continueAnyway",
        message: chalk.yellow("Continue anyway?"),
        default: false,
      },
    ]);

    if (!continueAnyway) {
      console.log(chalk.gray("\nDiff cancelled."));
      return;
    }
    console.log();
  } else if (!localStageFromHeader) {
    // No header found - file might be manually created
    console.log(chalk.yellow("⚠️  No PushEnv header found in local file."));
    console.log(chalk.gray(`  Assuming this is for '${stage}' stage (from --stage parameter).\n`));
  }

  // Check if remote exists
  console.log(chalk.gray("Checking remote..."));
  const remoteExists = await existsInR2(config.projectId, stage);
  if (!remoteExists) {
    console.log(chalk.red(`\n✗ No remote .env found for stage '${stage}'.`));
    console.log(chalk.gray(`  Run 'pushenv push --stage ${stage}' to upload it first.`));
    process.exit(1);
  }
  console.log(chalk.green("✓ Remote found"));

  // Download and decrypt remote (specific version or latest)
  let remoteContent: string;
  let versionInfo: string = "";
  let encryptedData: string;

  if (options.version) {
    // Download specific version
    console.log(chalk.gray(`Downloading version ${options.version}...`));
    const metadata = await readVersionMetadata(config.projectId, stage);
    if (!metadata) {
      console.log(chalk.red(`\n✗ No version history found.`));
      console.log(chalk.gray(`  This stage doesn't have versioning enabled yet.`));
      process.exit(1);
    }

    const versionExists = metadata.versions.some((v) => v.version === options.version);
    if (!versionExists) {
      console.log(chalk.red(`\n✗ Version ${options.version} not found.`));
      console.log(chalk.gray(`  Available versions: ${metadata.versions.map((v) => v.version).join(", ")}`));
      process.exit(1);
    }

    const versionData = metadata.versions.find((v) => v.version === options.version)!;
    versionInfo = ` (${versionData.message})`;

    try {
      encryptedData = await downloadVersionFromR2(config.projectId, stage, options.version);
      console.log(chalk.green(`✓ Downloaded version ${options.version}`));
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`\n✗ Failed to download version ${options.version}: ${error.message}`));
      }
      process.exit(1);
    }
  } else {
    // Download latest
    console.log(chalk.gray("Downloading latest remote..."));
    try {
      encryptedData = await downloadFromR2(config.projectId, stage);
      console.log(chalk.green("✓ Downloaded latest"));
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`\n✗ Download failed: ${error.message}`));
      }
      process.exit(1);
    }
  }

  // Extract salt and decrypt (common for both version and latest)
  console.log(chalk.gray("Decrypting..."));
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

  try {
    const decrypted = decrypt(actualEncryptedData, keyBuffer);
    remoteContent = decrypted;
    console.log(chalk.green("✓ Decrypted successfully"));
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unsupported state") || error.message.includes("auth")) {
        console.log(chalk.red("\n✗ Decryption failed: Incorrect passphrase or key."));
      } else {
        console.log(chalk.red(`\n✗ Failed to decrypt: ${error.message}`));
      }
    }
    process.exit(1);
  }

  // Remove headers from both for comparison
  const localEnvContent = removePushEnvHeader(localContent);
  const remoteEnvContent = removePushEnvHeader(remoteContent);

  // Parse both
  console.log(chalk.gray("Parsing and comparing..."));
  const localParsed = parseEnvContent(localEnvContent);
  const remoteParsed = parseEnvContent(remoteEnvContent);

  // Compare
  const diff = compareEnvs(localParsed.env, remoteParsed.env);

  // Display results
  console.log();
  console.log(chalk.cyan("═".repeat(60)));
  console.log(chalk.cyan.bold("  Diff Results"));
  if (versionInfo) {
    console.log(chalk.gray(`  Comparing with version ${options.version}${versionInfo}`));
  }
  console.log(chalk.cyan("═".repeat(60)));
  console.log();

  let hasChanges = false;

  // Added variables
  if (diff.added.length > 0) {
    hasChanges = true;
    console.log(chalk.green.bold(`Added (in remote, not in local): ${diff.added.length}`));
    for (const item of diff.added) {
      console.log(chalk.green(`  + ${item.key}=${item.value}`));
    }
    console.log();
  }

  // Removed variables
  if (diff.removed.length > 0) {
    hasChanges = true;
    console.log(chalk.red.bold(`Removed (in local, not in remote): ${diff.removed.length}`));
    for (const item of diff.removed) {
      console.log(chalk.red(`  - ${item.key}=${item.value}`));
    }
    console.log();
  }

  // Changed variables
  if (diff.changed.length > 0) {
    hasChanges = true;
    console.log(chalk.yellow.bold(`Changed: ${diff.changed.length}`));
    for (const item of diff.changed) {
      console.log(chalk.yellow(`  ~ ${item.key}:`));
      console.log(chalk.red(`    - ${item.localValue}  (local)`));
      console.log(chalk.green(`    + ${item.remoteValue}  (remote)`));
    }
    console.log();
  }

  // Unchanged
  if (diff.unchanged > 0) {
    console.log(chalk.gray(`Unchanged: ${diff.unchanged} variables`));
    console.log();
  }

  // Summary
  if (!hasChanges) {
    console.log(chalk.green.bold("✓ Local and remote are identical!"));
    console.log();
  } else {
    console.log(chalk.cyan("═".repeat(60)));
    console.log();
    console.log(chalk.gray("To sync with remote, run:"));
    console.log(chalk.white(`  pushenv pull --stage ${stage}`));
    console.log();
  }
}

