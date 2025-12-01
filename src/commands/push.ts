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
import { encrypt, decrypt } from "../utils/crypto.js";
import {
  uploadToR2,
  downloadFromR2,
  existsInR2,
  readVersionMetadata,
  writeVersionMetadata,
  uploadVersionedToR2,
  getLatestVersion,
  type VersionMetadata,
  type VersionInfo,
} from "../utils/r2-client.js";
import { parseEnvContent } from "../utils/env-parser.js";

/**
 * Compare two env contents to see if they're identical
 */
function areEnvsIdentical(localContent: string, remoteContent: string): boolean {
  // Remove PushEnv headers for comparison
  const removeHeader = (content: string): string => {
    const lines = content.split("\n");
    let start = 0;
    let foundHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || "";
      if (line && !line.startsWith("#")) {
        start = i;
        break;
      }
      if (line.includes("PushEnv") || line.includes("═")) {
        foundHeader = true;
      }
    }

    if (foundHeader) {
      for (let i = start; i < lines.length; i++) {
        const line = lines[i]?.trim() || "";
        if (line && !line.startsWith("#")) {
          start = i;
          break;
        }
      }
    }

    return lines.slice(start).join("\n");
  };

  const localClean = removeHeader(localContent);
  const remoteClean = removeHeader(remoteContent);

  const localParsed = parseEnvContent(localClean);
  const remoteParsed = parseEnvContent(remoteClean);

  // Compare keys
  if (localParsed.keys.length !== remoteParsed.keys.length) {
    return false;
  }

  // Compare each key-value pair
  for (const key of localParsed.keys) {
    if (localParsed.env[key] !== remoteParsed.env[key]) {
      return false;
    }
  }

  return true;
}

/**
 * Generate default message for a version
 */
function generateDefaultMessage(version: number, isFirst: boolean): string {
  if (isFirst) {
    return "Initial push";
  }
  return `Version ${version}`;
}

export interface PushOptions {
  message?: string | undefined;
  force?: boolean | undefined;
}

export async function pushCommand(
  stage: string,
  options: PushOptions = {}
): Promise<void> {
  console.log(chalk.cyan(`\n🔐 pushenv push - Encrypt and upload .env (${stage})\n`));

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

  // Production confirmation
  if (stage === "production") {
    console.log(chalk.red.bold("\n⚠️  WARNING: You are about to push to PRODUCTION"));
    console.log(chalk.red("   This will overwrite the remote production environment in cloud storage."));
    console.log();
    
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.red.bold("Are you sure you want to push to PRODUCTION?"),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray("\nPush cancelled."));
      return;
    }
    console.log();
  }

  // Check if .env file exists for this stage
  const envPath = path.resolve(process.cwd(), envPathForStage);
  if (!fs.existsSync(envPath)) {
    console.log(chalk.red(`✗ .env file not found at ${envPathForStage}`));
    process.exit(1);
  }

  console.log(chalk.gray(`Project: ${config.projectId}`));
  console.log(chalk.gray(`Stage: ${stage}`));
  console.log(chalk.gray(`Env file: ${envPathForStage}\n`));

  // Load derived key material for this project
  const keyEntry = getKeyEntry(config.projectId);
  if (!keyEntry) {
    console.log(chalk.red("✗ No key material found for this project on this machine."));
    console.log(
      chalk.gray(
        "  Run 'pushenv pull' here once (with the shared passphrase) to set up this machine."
      )
    );
    process.exit(1);
  }

  console.log();

  // Read .env file
  console.log(chalk.gray("Reading .env file..."));
  const envContent = fs.readFileSync(envPath, "utf8");
  const lineCount = envContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
  console.log(chalk.green(`✓ Found ${lineCount} environment variables`));

  // Encrypt
  console.log(chalk.gray("Encrypting..."));
  const salt = Buffer.from(keyEntry.salt, "base64");
  const key = Buffer.from(keyEntry.key, "base64");
  const encrypted = encrypt(envContent, key);
  
  // Store salt with encrypted data so teammates can decrypt
  // Format: salt_hex:encrypted_data
  const dataToUpload = `${salt.toString("hex")}:${encrypted}`;
  console.log(chalk.green("✓ Encrypted successfully"));

  // Check for changes (unless force)
  if (!options.force) {
    const remoteExists = await existsInR2(config.projectId, stage);
    if (remoteExists) {
      console.log(chalk.gray("Comparing with latest remote version..."));
      try {
        const remoteEncrypted = await downloadFromR2(config.projectId, stage);
        
        // Extract and decrypt remote
        const firstColon = remoteEncrypted.indexOf(":");
        if (firstColon !== -1) {
          const remoteSaltHex = remoteEncrypted.slice(0, firstColon);
          const remoteEncryptedData = remoteEncrypted.slice(firstColon + 1);
          const remoteSalt = Buffer.from(remoteSaltHex, "hex");
          
          // Use same key (salt should match for same project)
          const remoteDecrypted = decrypt(remoteEncryptedData, key);
          
          // Compare
          if (areEnvsIdentical(envContent, remoteDecrypted)) {
            console.log(chalk.yellow("\n✓ Local and remote are identical"));
            console.log(chalk.gray("No changes detected. Skipping push."));
            console.log(chalk.gray("(Use --force to push anyway)"));
            console.log();
            return;
          }
        }
      } catch (error) {
        // If comparison fails, continue with push
        console.log(chalk.gray("Could not compare with remote. Proceeding with push..."));
      }
    }
  }

  // Get or create version metadata
  let metadata = await readVersionMetadata(config.projectId, stage);
  const isFirst = !metadata || metadata.versions.length === 0;
  const nextVersion = metadata ? metadata.latest + 1 : 1;

  // Generate message
  const message = options.message || generateDefaultMessage(nextVersion, isFirst);

  // Upload versioned file
  console.log(chalk.gray("Creating new version..."));
  try {
    await uploadVersionedToR2(config.projectId, stage, nextVersion, dataToUpload);
    console.log(chalk.green(`✓ Uploaded version ${nextVersion}`));
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`✗ Upload failed: ${error.message}`));
    }
    process.exit(1);
  }

  // Update metadata
  const versionInfo: VersionInfo = {
    version: nextVersion,
    timestamp: new Date().toISOString(),
    message,
    key: `${config.projectId}/${stage}/v${nextVersion}/env.encrypted`,
  };

  if (!metadata) {
    metadata = {
      versions: [versionInfo],
      latest: nextVersion,
    };
  } else {
    metadata.versions.push(versionInfo);
    metadata.latest = nextVersion;
  }

  await writeVersionMetadata(config.projectId, stage, metadata);

  // Also update latest file (for backward compatibility)
  console.log(chalk.gray("Updating latest..."));
  try {
    await uploadToR2(config.projectId, dataToUpload, stage);
    console.log(chalk.green("✓ Updated latest version"));
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.yellow(`⚠ Warning: Could not update latest file: ${error.message}`));
    }
  }

  // Success message
  console.log(chalk.green("\n" + "═".repeat(50)));
  console.log(chalk.green.bold(`\n🎉 Push successful! (${stage})\n`));
  console.log(chalk.white(`Version: ${chalk.bold(`v${nextVersion}`)}`));
  console.log(chalk.white(`Message: ${chalk.gray(message)}`));
  console.log();
  console.log(chalk.cyan("Share with your team:"));
  console.log(chalk.white(`  1. Commit ${chalk.yellow(".pushenv/config.json")} to your repo`));
  console.log(chalk.white(`  2. Share the ${chalk.yellow("passphrase")} securely (Signal, 1Password, etc.)`));
  console.log(chalk.white(`  3. Teammates run ${chalk.yellow(`pushenv pull --stage ${stage}`)} and enter the passphrase`));
  console.log(chalk.green("\n" + "═".repeat(50) + "\n"));
}
