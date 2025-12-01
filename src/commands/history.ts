import chalk from "chalk";
import {
  isProjectInitialized,
  readProjectConfig,
  getEnvPathForStage,
  getConfiguredStages,
} from "../utils/config.js";
import { readVersionMetadata, existsInR2 } from "../utils/r2-client.js";

export async function historyCommand(stage: string): Promise<void> {
  console.log(chalk.cyan(`\n🔐 pushenv history - Version history (${stage})\n`));

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
  const remoteExists = await existsInR2(config.projectId, stage);
  if (!remoteExists) {
    console.log(chalk.red(`✗ No remote .env found for stage '${stage}'.`));
    console.log(chalk.gray(`  Run 'pushenv push --stage ${stage}' to upload it first.`));
    process.exit(1);
  }

  // Read metadata
  const metadata = await readVersionMetadata(config.projectId, stage);
  
  if (!metadata || metadata.versions.length === 0) {
    // Legacy version (no versioning yet)
    console.log(chalk.yellow("⚠️  No version history found."));
    console.log(chalk.gray("  This stage has a legacy version (created before versioning was added)."));
    console.log(chalk.gray("  Next push will create version 1 with history."));
    console.log();
    return;
  }

  // Display history
  console.log(chalk.cyan("Version History:"));
  console.log(chalk.cyan("═".repeat(70)));
  console.log();

  // Sort by version (newest first)
  const sortedVersions = [...metadata.versions].sort((a, b) => b.version - a.version);

  for (const version of sortedVersions) {
    const isLatest = version.version === metadata.latest;
    const date = new Date(version.timestamp);
    const dateStr = date.toLocaleString();

    const versionLabel = isLatest
      ? chalk.green.bold(`v${version.version} (latest)`)
      : chalk.white(`v${version.version}`);

    console.log(`  ${versionLabel}`);
    console.log(chalk.gray(`    ${dateStr}`));
    console.log(chalk.gray(`    ${version.message}`));
    console.log();
  }

  console.log(chalk.cyan("═".repeat(70)));
  console.log();
  console.log(chalk.gray("Commands:"));
  console.log(chalk.white(`  pushenv diff --stage ${stage} --version <N>  Compare with specific version`));
  console.log(chalk.white(`  pushenv rollback --stage ${stage} --version <N>  Restore a previous version`));
  console.log();
}

