/**
 * Lock file manager for brew.lock (JSONC format)
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type {
  BrewEntry,
  CaskEntry,
  LockFile,
  MasEntry,
  PackageType,
  TapEntry,
} from "./types.ts";
import { LockFileSchema } from "./types.ts";
import {
  getAllInstalledCasks,
  getAllInstalledFormulae,
  getAllTapsWithInfo,
  getMasApps,
  getPackageVersion,
} from "./version-resolver.ts";

/** Default lock file path */
export const DEFAULT_LOCK_FILE = join(homedir(), "brew.lock");

/**
 * Get the lock file path, checking the BREWLOCK environment variable first.
 * Falls back to DEFAULT_LOCK_FILE if not set.
 */
export function getLockFilePath(): string {
  const envPath = process.env.BREWLOCK;
  if (envPath) {
    return envPath;
  }
  return DEFAULT_LOCK_FILE;
}

/** Lock file format version */
const LOCK_VERSION = 1;

/**
 * Create an empty lock file with default structure
 */
export function createEmptyLockFile(): LockFile {
  return {
    version: LOCK_VERSION,
    tap: {},
    brew: {},
    cask: {},
    mas: {},
  };
}

/**
 * Parse a brew.lock file content (JSONC) into a LockFile structure.
 * Validates the parsed content against the schema.
 * Provides defaults for missing sections to handle partial lock files.
 */
export function parseLockFile(content: string): LockFile {
  if (!content.trim()) {
    return createEmptyLockFile();
  }

  try {
    const parsed = Bun.JSONC.parse(content) as Partial<LockFile>;
    // Provide defaults for missing sections before validation
    const withDefaults = {
      version: parsed.version ?? LOCK_VERSION,
      tap: parsed.tap ?? {},
      brew: parsed.brew ?? {},
      cask: parsed.cask ?? {},
      mas: parsed.mas ?? {},
    };
    // Validate and return the parsed lock file
    return LockFileSchema.parse(withDefaults);
  } catch {
    // Return empty lock file if parsing or validation fails
    return createEmptyLockFile();
  }
}

/**
 * Serialize a LockFile structure to JSONC format
 */
export function serializeLockFile(lockFile: LockFile): string {
  return `${JSON.stringify(lockFile, null, 2)}\n`;
}

/**
 * Read and parse a brew.lock file from disk
 */
export async function readLockFile(path?: string): Promise<LockFile> {
  const filePath = path ?? DEFAULT_LOCK_FILE;

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return createEmptyLockFile();
    }

    const content = await file.text();
    return parseLockFile(content);
  } catch {
    return createEmptyLockFile();
  }
}

/**
 * Write a LockFile to disk.
 * Validates the lock file before writing.
 */
export async function writeLockFile(
  lockFile: LockFile,
  path?: string
): Promise<void> {
  const filePath = path ?? DEFAULT_LOCK_FILE;
  // Validate before writing
  const validated = LockFileSchema.parse(lockFile);
  const content = serializeLockFile(validated);
  await Bun.write(filePath, content);
}

/**
 * Add or update a tap entry in the lock file
 */
export function upsertTap(
  lockFile: LockFile,
  name: string,
  entry: TapEntry
): LockFile {
  return {
    ...lockFile,
    tap: {
      ...lockFile.tap,
      [name]: entry,
    },
  };
}

/**
 * Add or update a brew entry in the lock file
 */
export function upsertBrew(
  lockFile: LockFile,
  name: string,
  entry: BrewEntry
): LockFile {
  return {
    ...lockFile,
    brew: {
      ...lockFile.brew,
      [name]: entry,
    },
  };
}

/**
 * Add or update a cask entry in the lock file
 */
export function upsertCask(
  lockFile: LockFile,
  name: string,
  entry: CaskEntry
): LockFile {
  return {
    ...lockFile,
    cask: {
      ...lockFile.cask,
      [name]: entry,
    },
  };
}

/**
 * Add or update a mas entry in the lock file
 */
export function upsertMas(
  lockFile: LockFile,
  name: string,
  entry: MasEntry
): LockFile {
  return {
    ...lockFile,
    mas: {
      ...lockFile.mas,
      [name]: entry,
    },
  };
}

/**
 * Remove a tap entry from the lock file
 */
export function removeTap(lockFile: LockFile, name: string): LockFile {
  const { [name]: _, ...rest } = lockFile.tap;
  return {
    ...lockFile,
    tap: rest,
  };
}

/**
 * Remove a brew entry from the lock file
 */
export function removeBrew(lockFile: LockFile, name: string): LockFile {
  const { [name]: _, ...rest } = lockFile.brew;
  return {
    ...lockFile,
    brew: rest,
  };
}

/**
 * Remove a cask entry from the lock file
 */
export function removeCask(lockFile: LockFile, name: string): LockFile {
  const { [name]: _, ...rest } = lockFile.cask;
  return {
    ...lockFile,
    cask: rest,
  };
}

/**
 * Remove a mas entry from the lock file
 */
export function removeMas(lockFile: LockFile, name: string): LockFile {
  const { [name]: _, ...rest } = lockFile.mas;
  return {
    ...lockFile,
    mas: rest,
  };
}

/**
 * Remove an entry from the lock file by type and name
 */
export function removeEntry(
  lockFile: LockFile,
  type: PackageType,
  name: string
): LockFile {
  switch (type) {
    case "tap":
      return removeTap(lockFile, name);
    case "brew":
      return removeBrew(lockFile, name);
    case "cask":
      return removeCask(lockFile, name);
    case "mas":
      return removeMas(lockFile, name);
  }
}

/**
 * Generate a lock file from currently installed packages
 */
export async function generateLockFile(): Promise<LockFile> {
  const lockFile = createEmptyLockFile();

  // Get all taps with info
  const taps = await getAllTapsWithInfo();
  for (const tap of taps) {
    const entry: TapEntry = {};
    if (tap.url) {
      entry.url = tap.url;
    }
    if (tap.commit) {
      entry.commit = tap.commit;
    }
    if (tap.official) {
      entry.official = tap.official;
    }
    lockFile.tap[tap.name] = entry;
  }

  // Get all installed formulae
  const formulae = await getAllInstalledFormulae();
  for (const formula of formulae) {
    const entry: BrewEntry = {
      version: formula.version,
    };
    if (formula.installed !== undefined) {
      entry.installed = formula.installed;
    }
    if (formula.revision !== undefined) {
      entry.revision = formula.revision;
    }
    if (formula.tap !== undefined) {
      entry.tap = formula.tap;
    }
    if (formula.pinned !== undefined) {
      entry.pinned = formula.pinned;
    }
    if (formula.dependencies !== undefined) {
      entry.dependencies = formula.dependencies;
    }
    if (formula.sha256 !== undefined) {
      entry.sha256 = formula.sha256;
    }
    if (formula.installed_as_dependency !== undefined) {
      entry.installed_as_dependency = formula.installed_as_dependency;
    }
    if (formula.installed_on_request !== undefined) {
      entry.installed_on_request = formula.installed_on_request;
    }
    lockFile.brew[formula.name] = entry;
  }

  // Get all installed casks
  const casks = await getAllInstalledCasks();
  for (const cask of casks) {
    const entry: CaskEntry = {
      version: cask.version,
    };
    if (cask.tap !== undefined) {
      entry.tap = cask.tap;
    }
    if (cask.sha256 !== undefined) {
      entry.sha256 = cask.sha256;
    }
    if (cask.auto_updates !== undefined) {
      entry.auto_updates = cask.auto_updates;
    }
    lockFile.cask[cask.name] = entry;
  }

  // Get all mas apps
  const masApps = await getMasApps();
  for (const app of masApps) {
    if (app.id !== undefined) {
      lockFile.mas[app.name] = {
        id: app.id,
        version: app.version,
      };
    }
  }

  return lockFile;
}

/**
 * Check if installed packages match the lock file
 */
export async function checkLockFile(lockFilePath: string): Promise<{
  matches: boolean;
  mismatches: Array<{ name: string; expected: string; actual: string | null }>;
}> {
  const lockFile = await readLockFile(lockFilePath);
  const mismatches: Array<{
    name: string;
    expected: string;
    actual: string | null;
  }> = [];

  // Check brew entries
  for (const name of Object.keys(lockFile.brew)) {
    const entry = lockFile.brew[name];
    const actualVersion = await getPackageVersion("brew", name);
    if (entry && actualVersion !== entry.version) {
      mismatches.push({
        name,
        expected: entry.version,
        actual: actualVersion,
      });
    }
  }

  // Check cask entries
  for (const name of Object.keys(lockFile.cask)) {
    const entry = lockFile.cask[name];
    const actualVersion = await getPackageVersion("cask", name);
    if (entry && actualVersion !== entry.version) {
      mismatches.push({
        name,
        expected: entry.version,
        actual: actualVersion,
      });
    }
  }

  // Check mas entries
  for (const name of Object.keys(lockFile.mas)) {
    const entry = lockFile.mas[name];
    const actualVersion = await getPackageVersion("mas", name);
    if (entry && actualVersion !== entry.version) {
      mismatches.push({
        name,
        expected: entry.version,
        actual: actualVersion,
      });
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}
