/**
 * Bundle handler for version-locked installations
 */

import { executeBrewCommandStreaming } from "./executor.ts";
import { readLockFile } from "./lock-manager.ts";
import type { BundleInstallOptions, LockEntry, PackageType } from "./types.ts";
import { getAllTaps, getPackageVersion } from "./version-resolver.ts";

/** Order of package types for installation */
const INSTALL_ORDER: PackageType[] = ["tap", "brew", "cask", "mas"];

/**
 * Install packages from a lock file with version constraints
 */
export async function bundleInstall(
  options: BundleInstallOptions
): Promise<boolean> {
  const { lockFilePath, strict = false, verbose = false } = options;

  // Read the lock file
  const lockFile = await readLockFile(lockFilePath);

  if (lockFile.entries.length === 0) {
    if (verbose) {
      console.log("No packages in lock file.");
    }
    return true;
  }

  // Group entries by type and sort by install order
  const grouped = new Map<PackageType, LockEntry[]>();
  for (const type of INSTALL_ORDER) {
    grouped.set(type, []);
  }

  for (const entry of lockFile.entries) {
    grouped.get(entry.type)?.push(entry);
  }

  let allSuccess = true;

  // Process each type in order
  for (const type of INSTALL_ORDER) {
    const entries = grouped.get(type) ?? [];
    for (const entry of entries) {
      const success = await installEntry(entry, strict, verbose);
      if (!success) {
        allSuccess = false;
        if (strict) {
          return false;
        }
      }
    }
  }

  return allSuccess;
}

/**
 * Install a single entry from the lock file
 */
async function installEntry(
  entry: LockEntry,
  strict: boolean,
  verbose: boolean
): Promise<boolean> {
  // Check if already installed with correct version
  const currentVersion = await getPackageVersion(entry.type, entry.name);

  if (entry.type === "tap") {
    // For taps, just check if it exists
    const taps = await getAllTaps();
    if (taps.includes(entry.name)) {
      if (verbose) {
        console.log(`Tap ${entry.name} already added.`);
      }
      return true;
    }

    // Add the tap
    if (verbose) {
      console.log(`Adding tap ${entry.name}...`);
    }
    const result = await executeBrewCommandStreaming(["tap", entry.name]);
    return result.success;
  }

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(
        `${entry.type} ${entry.name} already at version ${entry.version}.`
      );
    }
    return true;
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    // Version mismatch
    console.warn(
      `Warning: ${entry.name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${entry.name}`);
      return false;
    }
  }

  // Install the package
  if (verbose) {
    console.log(`Installing ${entry.type} ${entry.name}...`);
  }

  let result: { success: boolean } | undefined;
  switch (entry.type) {
    case "brew": {
      // Check if versioned formula is available (e.g., python@3.11)
      const hasVersionSuffix = entry.name.includes("@");
      if (hasVersionSuffix) {
        result = await executeBrewCommandStreaming(["install", entry.name]);
      } else {
        // Install without version constraint (Homebrew doesn't support arbitrary versions)
        result = await executeBrewCommandStreaming(["install", entry.name]);
      }
      break;
    }
    case "cask":
      result = await executeBrewCommandStreaming([
        "install",
        "--cask",
        entry.name,
      ]);
      break;
    case "mas":
      if (entry.id) {
        result = await executeMasInstall(entry.id, verbose);
      } else {
        console.error(`No App Store ID for ${entry.name}`);
        return false;
      }
      break;
    default:
      return false;
  }

  return result?.success ?? false;
}

/**
 * Execute mas install for App Store apps
 */
async function executeMasInstall(
  id: number,
  verbose: boolean
): Promise<{ success: boolean }> {
  try {
    if (verbose) {
      console.log(`Installing App Store app ${id}...`);
    }

    const proc = Bun.spawn(["mas", "install", String(id)], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    return { success: exitCode === 0 };
  } catch {
    return { success: false };
  }
}
