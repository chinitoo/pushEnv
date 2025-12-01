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
  readVersionMetadata,
  downloadVersionFromR2,
  uploadToR2,
  uploadVersionedToR2,
  writeVersionMetadata,
  type VersionMetadata,
  type VersionInfo,
} from "../utils/r2-client.js";
import { decrypt } from "../utils/crypto.js";

export async function rollbackCommand(stage: string, version: number): Promise<void> {
  console.log(chalk.cyan(`\n🔐 pushenv rollback - Restore previous version (${stage})\n`));

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
  console.log(chalk.gray(`Target version: ${version}\n`));

  // Production confirmation
  if (stage === "production") {
    console.log(chalk.red.bold("\n⚠️  WARNING: You are about to rollback PRODUCTION"));
    console.log(chalk.red(`   This will restore version ${version} and make it the latest.`));
    console.log();
    
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.red.bold("Are you sure you want to rollback PRODUCTION?"),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray("\nRollback cancelled."));
      return;
    }
    console.log();
  }

  // Read metadata
  const metadata = await readVersionMetadata(config.projectId, stage);
  if (!metadata) {
    console.log(chalk.red(`\n✗ No version history found.`));
    console.log(chalk.gray(`  This stage doesn't have versioning enabled yet.`));
    process.exit(1);
  }

  // Check if version exists
  const versionExists = metadata.versions.some((v) => v.version === version);
  if (!versionExists) {
    console.log(chalk.red(`\n✗ Version ${version} not found.`));
    console.log(chalk.gray(`  Available versions: ${metadata.versions.map((v) => v.version).join(", ")}`));
    process.exit(1);
  }

  const versionData = metadata.versions.find((v) => v.version === version)!;
  const currentLatest = metadata.latest;

  if (version === currentLatest) {
    console.log(chalk.yellow(`\n⚠️  Version ${version} is already the latest version.`));
    console.log(chalk.gray("  No rollback needed."));
    console.log();
    return;
  }

  // Show what will happen
  console.log(chalk.yellow("Rollback details:"));
  console.log(chalk.white(`  Current latest: v${currentLatest}`));
  console.log(chalk.white(`  Rolling back to: v${version}`));
  console.log(chalk.gray(`  Message: ${versionData.message}`));
  console.log(chalk.gray(`  Timestamp: ${new Date(versionData.timestamp).toLocaleString()}`));
  console.log();

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow.bold(`Rollback to version ${version}?`),
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray("\nRollback cancelled."));
    return;
  }

  // Download the version to rollback to
  console.log(chalk.gray(`Downloading version ${version}...`));
  let encryptedData: string;
  try {
    encryptedData = await downloadVersionFromR2(config.projectId, stage, version);
    console.log(chalk.green(`✓ Downloaded version ${version}`));
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`\n✗ Failed to download version ${version}: ${error.message}`));
    }
    process.exit(1);
  }

  // Create new version with rollback data
  const nextVersion = currentLatest + 1;
  const rollbackMessage = `Rollback to v${version}`;

  console.log(chalk.gray(`Creating new version ${nextVersion} (rollback)...`));
  try {
    await uploadVersionedToR2(config.projectId, stage, nextVersion, encryptedData);
    console.log(chalk.green(`✓ Created version ${nextVersion}`));
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`\n✗ Failed to create rollback version: ${error.message}`));
    }
    process.exit(1);
  }

  // Update metadata
  const rollbackVersionInfo: VersionInfo = {
    version: nextVersion,
    timestamp: new Date().toISOString(),
    message: rollbackMessage,
    key: `${config.projectId}/${stage}/v${nextVersion}/env.encrypted`,
  };

  metadata.versions.push(rollbackVersionInfo);
  metadata.latest = nextVersion;

  await writeVersionMetadata(config.projectId, stage, metadata);

  // Update latest file (for backward compatibility)
  console.log(chalk.gray("Updating latest..."));
  try {
    await uploadToR2(config.projectId, encryptedData, stage);
    console.log(chalk.green("✓ Updated latest version"));
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.yellow(`⚠ Warning: Could not update latest file: ${error.message}`));
    }
  }

  // Success message
  console.log(chalk.green("\n" + "═".repeat(50)));
  console.log(chalk.green.bold(`\n🎉 Rollback successful! (${stage})\n`));
  console.log(chalk.white(`Version ${version} has been restored as version ${nextVersion}.`));
  console.log(chalk.white(`Latest version is now: ${chalk.bold(`v${nextVersion}`)}`));
  console.log();
  console.log(chalk.gray("To apply locally, run:"));
  console.log(chalk.white(`  pushenv pull --stage ${stage}`));
  console.log(chalk.green("\n" + "═".repeat(50) + "\n"));
}

