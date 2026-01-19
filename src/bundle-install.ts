/**
 * Bundle handler for version-locked installations
 */

import { executeBrewCommandStreaming } from "./executor.ts";
import { readLockFile } from "./lock-manager.ts";
import type {
  BrewEntry,
  BundleInstallOptions,
  CaskEntry,
  MasEntry,
  TapEntry,
} from "./types.ts";
import { getAllTaps, getPackageVersion } from "./version-resolver.ts";

/**
 * Install packages from a lock file with version constraints
 */
export async function bundleInstall(
  options: BundleInstallOptions
): Promise<boolean> {
  const { lockFilePath, strict = false, verbose = false } = options;

  // Read the lock file
  const lockFile = await readLockFile(lockFilePath);

  const hasTaps = Object.keys(lockFile.tap).length > 0;
  const hasBrews = Object.keys(lockFile.brew).length > 0;
  const hasCasks = Object.keys(lockFile.cask).length > 0;
  const hasMas = Object.keys(lockFile.mas).length > 0;

  if (!hasTaps && !hasBrews && !hasCasks && !hasMas) {
    if (verbose) {
      console.log("No packages in lock file.");
    }
    return true;
  }

  let allSuccess = true;

  // Install taps first
  for (const [name, entry] of Object.entries(lockFile.tap)) {
    const success = await installTap(name, entry, verbose);
    if (!success) {
      allSuccess = false;
      if (strict) {
        return false;
      }
    }
  }

  // Install brew formulae
  for (const [name, entry] of Object.entries(lockFile.brew)) {
    const success = await installBrew(name, entry, strict, verbose);
    if (!success) {
      allSuccess = false;
      if (strict) {
        return false;
      }
    }
  }

  // Install casks
  for (const [name, entry] of Object.entries(lockFile.cask)) {
    const success = await installCask(name, entry, strict, verbose);
    if (!success) {
      allSuccess = false;
      if (strict) {
        return false;
      }
    }
  }

  // Install Mac App Store apps
  for (const [name, entry] of Object.entries(lockFile.mas)) {
    const success = await installMas(name, entry, strict, verbose);
    if (!success) {
      allSuccess = false;
      if (strict) {
        return false;
      }
    }
  }

  return allSuccess;
}

/**
 * Install a tap
 */
async function installTap(
  name: string,
  entry: TapEntry,
  verbose: boolean
): Promise<boolean> {
  // Check if tap is already added
  const taps = await getAllTaps();
  if (taps.includes(name)) {
    if (verbose) {
      console.log(`Tap ${name} already added.`);
    }
    return true;
  }

  // Add the tap (include URL if provided)
  if (verbose) {
    console.log(`Adding tap ${name}...`);
  }

  const args = ["tap", name];
  if (entry.url) {
    args.push(entry.url);
  }

  const result = await executeBrewCommandStreaming(args);
  return result.success;
}

/**
 * Install a brew formula
 */
async function installBrew(
  name: string,
  entry: BrewEntry,
  strict: boolean,
  verbose: boolean
): Promise<boolean> {
  const currentVersion = await getPackageVersion("brew", name);

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`brew ${name} already at version ${entry.version}.`);
    }
    return true;
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return false;
    }
  }

  if (verbose) {
    console.log(`Installing brew ${name}...`);
  }

  const result = await executeBrewCommandStreaming(["install", name]);
  return result.success;
}

/**
 * Install a cask
 */
async function installCask(
  name: string,
  entry: CaskEntry,
  strict: boolean,
  verbose: boolean
): Promise<boolean> {
  const currentVersion = await getPackageVersion("cask", name);

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`cask ${name} already at version ${entry.version}.`);
    }
    return true;
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return false;
    }
  }

  if (verbose) {
    console.log(`Installing cask ${name}...`);
  }

  const result = await executeBrewCommandStreaming(["install", "--cask", name]);
  return result.success;
}

/**
 * Install a Mac App Store app
 */
async function installMas(
  name: string,
  entry: MasEntry,
  strict: boolean,
  verbose: boolean
): Promise<boolean> {
  const currentVersion = await getPackageVersion("mas", name);

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`mas ${name} already at version ${entry.version}.`);
    }
    return true;
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return false;
    }
  }

  if (verbose) {
    console.log(`Installing App Store app ${name} (${entry.id})...`);
  }

  try {
    const proc = Bun.spawn(["mas", "install", String(entry.id)], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
