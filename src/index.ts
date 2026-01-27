#!/usr/bin/env bun

/**
 * brewlock - A version-locking wrapper for Homebrew
 *
 * This CLI intercepts brew commands, executes them, and maintains
 * a brew.lock file with exact versions for reproducible installations.
 */

import { $ } from "bun";

import { bundleInstall } from "./bundle-install.ts";
import { executeBrewCommandStreaming } from "./executor.ts";
import {
  checkLockFile,
  generateLockFile,
  getLockFilePath,
  readLockFile,
  removeBrew,
  removeCask,
  removeTap,
  upsertBrew,
  upsertCask,
  upsertTap,
  writeLockFile,
} from "./lock-manager.ts";
import { parseCommand } from "./parser.ts";
import type { PackageType } from "./types.ts";
import { getAllTapsWithInfo, getPackageVersion } from "./version-resolver.ts";

export { bundleInstall } from "./bundle-install.ts";
export { executeBrewCommand, executeBrewCommandStreaming } from "./executor.ts";
export {
  checkLockFile,
  createEmptyLockFile,
  DEFAULT_LOCK_FILE,
  generateLockFile,
  getLockFilePath,
  parseLockFile,
  readLockFile,
  removeBrew,
  removeCask,
  removeEntry,
  removeMas,
  removeTap,
  serializeLockFile,
  upsertBrew,
  upsertCask,
  upsertMas,
  upsertTap,
  writeLockFile,
} from "./lock-manager.ts";
// Export all public APIs
export { isModifyingCommand, parseCommand } from "./parser.ts";
// Export types
export type * from "./types.ts";
export {
  getAllInstalledCasks,
  getAllInstalledFormulae,
  getAllTaps,
  getAllTapsWithInfo,
  getCaskVersion,
  getFormulaVersion,
  getMasApps,
  getPackageVersion,
} from "./version-resolver.ts";

/**
 * Resolve brew paths and determine if brewlock is aliased as 'brew'
 * Returns the real brew path and whether the alias is set up
 */
async function resolveBrewPaths(): Promise<{
  isAliased: boolean;
  realBrewPath: string | null;
}> {
  try {
    const result = await $`which -a brew`.quiet().text();
    const paths = result.trim().split("\n").filter(Boolean);

    const isAliased = paths[0]?.includes("brewlock") ?? false;
    const realBrewPath = paths.find((p) => !p.includes("brewlock")) ?? null;

    return { isAliased, realBrewPath };
  } catch {
    return { isAliased: false, realBrewPath: null };
  }
}

/**
 * Get help output from the real brew binary
 */
async function getRealBrewHelp(brewPath: string): Promise<string | null> {
  try {
    const result = await $`${brewPath} help`.quiet().text();
    return result;
  } catch {
    return null;
  }
}

/**
 * Help text components
 */
const HELP_TEXT = {
  commands: (cmd: string) => `
COMMANDS:
  ${cmd} bundle install    Install from Brewfile using version constraints
  ${cmd} lock              Generate brew.lock from installed packages
  ${cmd} check             Check if installed versions match brew.lock
  ${cmd} help              Show this help message
`,

  behavior: `
BEHAVIOR:
  All standard brew commands are supported. brewlock will:
  - Pass commands through to brew
  - Update brew.lock when packages are installed/uninstalled/upgraded
  - Use brew.lock for 'bundle install' to verify version compatibility`,

  examples: (cmd: string) => `
EXAMPLES:
  ${cmd} install git       Install git and update brew.lock
  ${cmd} upgrade           Upgrade all packages and update brew.lock
  ${cmd} lock              Generate brew.lock from current installation
  ${cmd} check             Verify installed versions match brew.lock
  ${cmd} bundle install    Install from Brewfile using version constraints
  ${cmd} bundle install /path/to/brew.lock
                           Optionally specify lock file path (falls back to
                           $BREWLOCK or ~/brew.lock)`,

  envAndFiles: `
ENVIRONMENT VARIABLES:
  BREWLOCK     Path to the lock file (default: ~/brew.lock)
               Example: export BREWLOCK=/path/to/your/brew.lock

FILES:
  brew.lock    Lock file in Brewfile format with version information`,

  aliasSetup: `
SETUP:
  To use brewlock as a transparent wrapper, add this alias to your shell:

  # For zsh (add to ~/.zshrc):
  alias brew='brewlock'

  # For bash (add to ~/.bashrc):
  alias brew='brewlock'

  # For fish (add to ~/.config/fish/config.fish):
  alias brew 'brewlock'`,
};

/**
 * Print help message
 */
async function printHelp(): Promise<void> {
  const { isAliased, realBrewPath } = await resolveBrewPaths();

  if (isAliased && realBrewPath) {
    // Show real brew help followed by brewlock-specific commands
    const brewHelp = await getRealBrewHelp(realBrewPath);
    if (brewHelp) {
      console.log(brewHelp);
    }

    console.log(HELP_TEXT.commands("brew"));
    console.log(HELP_TEXT.behavior);
    console.log(HELP_TEXT.examples("brew"));
    console.log(HELP_TEXT.envAndFiles);
  } else {
    // Show standalone brewlock help with alias setup instructions
    console.log(`
brewlock - A version-locking wrapper for Homebrew

DESCRIPTION:
  brewlock wraps the Homebrew CLI and maintains a brew.lock file containing
  exact versions of all installed packages. This enables reproducible
  installations across machines.`);
    console.log(HELP_TEXT.commands("brewlock"));
    console.log(HELP_TEXT.behavior);
    console.log(HELP_TEXT.aliasSetup);
    console.log(HELP_TEXT.examples("brewlock"));
    console.log(HELP_TEXT.envAndFiles);
  }
  console.log();
}

/**
 * Generate a lock file from currently installed packages
 */
async function handleLock(): Promise<void> {
  console.log("Generating brew.lock from installed packages...");

  const lockFilePath = getLockFilePath();
  const lockFile = await generateLockFile();
  await writeLockFile(lockFile, lockFilePath);

  console.log(`\nGenerated ${lockFilePath} with:`);
  console.log(`  - ${Object.keys(lockFile.tap).length} taps`);
  console.log(`  - ${Object.keys(lockFile.brew).length} formulae`);
  console.log(`  - ${Object.keys(lockFile.cask).length} casks`);
  console.log(`  - ${Object.keys(lockFile.mas).length} Mac App Store apps`);
}

/**
 * Check if installed packages match the lock file
 */
async function handleCheck(): Promise<void> {
  console.log("Checking installed packages against brew.lock...");

  const result = await checkLockFile(getLockFilePath());

  if (result.matches) {
    console.log("\n✓ All installed packages match brew.lock");
  } else {
    console.log("\n✗ Version mismatches found:");
    for (const mismatch of result.mismatches) {
      console.log(`  ${mismatch.name}:`);
      console.log(`    Expected: ${mismatch.expected}`);
      console.log(`    Actual:   ${mismatch.actual ?? "not installed"}`);
    }
    process.exit(1);
  }
}

/**
 * Update the lock file after a modifying command
 */
async function updateLockFile(
  command: string,
  packages: string[],
  isCask: boolean
): Promise<void> {
  const lockFilePath = getLockFilePath();
  let lockFile = await readLockFile(lockFilePath);
  const type: PackageType = isCask ? "cask" : "brew";

  if (
    command === "install" ||
    command === "reinstall" ||
    command === "upgrade"
  ) {
    // Add or update entries for installed packages
    for (const pkg of packages) {
      const version = await getPackageVersion(type, pkg);
      if (version) {
        if (type === "cask") {
          lockFile = upsertCask(lockFile, pkg, { version });
        } else {
          lockFile = upsertBrew(lockFile, pkg, { version });
        }
        console.log(`brewlock: Updated ${type} "${pkg}" → ${version}`);
      }
    }

    // If upgrade with no packages, update all
    if (command === "upgrade" && packages.length === 0) {
      console.log("brewlock: Regenerating lock file after upgrade...");
      lockFile = await generateLockFile();
    }
  } else if (
    command === "uninstall" ||
    command === "remove" ||
    command === "rm"
  ) {
    // Remove entries for uninstalled packages
    for (const pkg of packages) {
      if (type === "cask") {
        lockFile = removeCask(lockFile, pkg);
      } else {
        lockFile = removeBrew(lockFile, pkg);
      }
      console.log(`brewlock: Removed ${type} "${pkg}" from lock file`);
    }
  } else if (command === "tap") {
    // Add tap entries with URL and commit info
    const tapInfos = await getAllTapsWithInfo();
    for (const tapName of packages) {
      const tapInfo = tapInfos.find((t) => t.name === tapName);
      lockFile = upsertTap(lockFile, tapName, {
        url: tapInfo?.url,
        commit: tapInfo?.commit,
      });
      console.log(`brewlock: Added tap "${tapName}"`);
    }
  } else if (command === "untap") {
    // Remove tap entries
    for (const tap of packages) {
      lockFile = removeTap(lockFile, tap);
      console.log(`brewlock: Removed tap "${tap}" from lock file`);
    }
  }

  await writeLockFile(lockFile, lockFilePath);
}

/**
 * Parse lock file path from bundle install arguments
 * Supports: --lockfile=/path, --lockfile /path, or positional /path
 */
function parseBundleInstallLockPath(args: string[]): string {
  // Find args after "bundle install"
  const bundleIndex = args.indexOf("bundle");
  if (bundleIndex === -1) return getLockFilePath();

  const installIndex = args.indexOf("install", bundleIndex);
  if (installIndex === -1) return getLockFilePath();

  // Get remaining args after "bundle install"
  const remainingArgs = args.slice(installIndex + 1);

  for (let i = 0; i < remainingArgs.length; i++) {
    const arg = remainingArgs[i];
    if (arg === undefined) continue;

    // Handle --lockfile=/path/to/file
    if (arg.startsWith("--lockfile=")) {
      return arg.slice("--lockfile=".length);
    }

    // Handle --lockfile /path/to/file
    const nextArg = remainingArgs[i + 1];
    if (arg === "--lockfile" && nextArg !== undefined) {
      return nextArg;
    }

    // Handle positional argument (first non-flag argument)
    if (!arg.startsWith("-")) {
      return arg;
    }
  }

  return getLockFilePath();
}

/**
 * Handle bundle install with version checking
 */
async function handleBundleInstall(lockFilePath?: string): Promise<boolean> {
  const resolvedPath = lockFilePath ?? getLockFilePath();
  console.log(
    `brewlock: Installing from ${resolvedPath} with version constraints...`
  );

  const success = await bundleInstall({
    lockFilePath: resolvedPath,
    verbose: true,
  });

  return success;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await printHelp();
    process.exit(0);
  }

  // Handle brewlock-specific commands
  const firstArg = args[0];
  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    await printHelp();
    process.exit(0);
  }

  if (firstArg === "lock") {
    await handleLock();
    process.exit(0);
  }

  if (firstArg === "check") {
    await handleCheck();
    process.exit(0);
  }

  // Parse the brew command
  const parsed = parseCommand(args);

  // Handle bundle install specially
  if (parsed.isBundle && parsed.subcommand === "install") {
    const lockFilePath = parseBundleInstallLockPath(args);
    const success = await handleBundleInstall(lockFilePath);
    process.exit(success ? 0 : 1);
  }

  // Execute the brew command
  const result = await executeBrewCommandStreaming(args);

  // Update lock file if the command modifies packages and succeeded
  if (result.success && parsed.modifiesPackages) {
    await updateLockFile(parsed.command, parsed.packages, parsed.isCask);
  }

  process.exit(result.exitCode);
}

// Run if executed directly
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
