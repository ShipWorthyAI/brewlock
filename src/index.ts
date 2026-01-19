#!/usr/bin/env bun

/**
 * brewlock - A version-locking wrapper for Homebrew
 *
 * This CLI intercepts brew commands, executes them, and maintains
 * a brew.lock file with exact versions for reproducible installations.
 */

import { bundleInstall } from "./bundle-install.ts";
import { executeBrewCommandStreaming } from "./executor.ts";
import {
  checkLockFile,
  DEFAULT_LOCK_FILE,
  generateLockFile,
  readLockFile,
  removeEntry,
  upsertEntry,
  writeLockFile,
} from "./lock-manager.ts";
import { parseCommand } from "./parser.ts";
import type { LockEntry, PackageType } from "./types.ts";
import { getPackageVersion } from "./version-resolver.ts";

export { bundleInstall } from "./bundle-install.ts";
export { executeBrewCommand, executeBrewCommandStreaming } from "./executor.ts";
export {
  checkLockFile,
  DEFAULT_LOCK_FILE,
  generateLockFile,
  parseLockFile,
  readLockFile,
  removeEntry,
  serializeLockFile,
  upsertEntry,
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
  getCaskVersion,
  getFormulaVersion,
  getMasApps,
  getPackageVersion,
} from "./version-resolver.ts";

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
brewlock - A version-locking wrapper for Homebrew

USAGE:
  brewlock <brew-command> [args...]
  brewlock lock              Generate brew.lock from installed packages
  brewlock check             Check if installed versions match brew.lock
  brewlock help              Show this help message

DESCRIPTION:
  brewlock wraps the Homebrew CLI and maintains a brew.lock file containing
  exact versions of all installed packages. This enables reproducible
  installations across machines.

COMMANDS:
  All standard brew commands are supported. brewlock will:
  - Pass commands through to brew
  - Update brew.lock when packages are installed/uninstalled/upgraded
  - Use brew.lock for 'bundle install' to verify version compatibility

BREWLOCK-SPECIFIC COMMANDS:
  lock     Generate a brew.lock file from currently installed packages
  check    Check if installed packages match versions in brew.lock
  help     Show this help message

SETUP:
  To use brewlock as a transparent wrapper, add this alias to your shell:

  # For zsh (add to ~/.zshrc):
  alias brew='brewlock'

  # For bash (add to ~/.bashrc):
  alias brew='brewlock'

  # For fish (add to ~/.config/fish/config.fish):
  alias brew 'brewlock'

EXAMPLES:
  brewlock install git       Install git and update brew.lock
  brewlock upgrade           Upgrade all packages and update brew.lock
  brewlock lock              Generate brew.lock from current installation
  brewlock check             Verify installed versions match brew.lock
  brewlock bundle install    Install from Brewfile using version constraints

FILES:
  brew.lock    Lock file in Brewfile format with version information
`);
}

/**
 * Generate a lock file from currently installed packages
 */
async function handleLock(): Promise<void> {
  console.log("Generating brew.lock from installed packages...");

  const lockFile = await generateLockFile();
  await writeLockFile(lockFile, DEFAULT_LOCK_FILE);

  console.log(`\nGenerated ${DEFAULT_LOCK_FILE} with:`);
  console.log(
    `  - ${lockFile.entries.filter((e) => e.type === "tap").length} taps`
  );
  console.log(
    `  - ${lockFile.entries.filter((e) => e.type === "brew").length} formulae`
  );
  console.log(
    `  - ${lockFile.entries.filter((e) => e.type === "cask").length} casks`
  );
  console.log(
    `  - ${lockFile.entries.filter((e) => e.type === "mas").length} Mac App Store apps`
  );
}

/**
 * Check if installed packages match the lock file
 */
async function handleCheck(): Promise<void> {
  console.log("Checking installed packages against brew.lock...");

  const result = await checkLockFile(DEFAULT_LOCK_FILE);

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
  let lockFile = await readLockFile(DEFAULT_LOCK_FILE);
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
        const entry: LockEntry = { type, name: pkg, version };
        lockFile = upsertEntry(lockFile, entry);
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
      lockFile = removeEntry(lockFile, type, pkg);
      console.log(`brewlock: Removed ${type} "${pkg}" from lock file`);
    }
  } else if (command === "tap") {
    // Add tap entries
    for (const tap of packages) {
      const entry: LockEntry = { type: "tap", name: tap };
      lockFile = upsertEntry(lockFile, entry);
      console.log(`brewlock: Added tap "${tap}"`);
    }
  } else if (command === "untap") {
    // Remove tap entries
    for (const tap of packages) {
      lockFile = removeEntry(lockFile, "tap", tap);
      console.log(`brewlock: Removed tap "${tap}" from lock file`);
    }
  }

  await writeLockFile(lockFile, DEFAULT_LOCK_FILE);
}

/**
 * Handle bundle install with version checking
 */
async function handleBundleInstall(): Promise<boolean> {
  console.log(
    "brewlock: Installing from brew.lock with version constraints..."
  );

  const success = await bundleInstall({
    lockFilePath: DEFAULT_LOCK_FILE,
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
    printHelp();
    process.exit(0);
  }

  // Handle brewlock-specific commands
  const firstArg = args[0];
  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    printHelp();
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
    const success = await handleBundleInstall();
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
