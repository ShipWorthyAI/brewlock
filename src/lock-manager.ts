/**
 * Lock file manager for brew.lock
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { LockEntry, LockFile, PackageType } from "./types.ts";
import {
  getAllInstalledCasks,
  getAllInstalledFormulae,
  getAllTaps,
  getMasApps,
  getPackageVersion,
} from "./version-resolver.ts";

/** Default lock file path */
export const DEFAULT_LOCK_FILE = join(homedir(), "brew.lock");

/** Lock file format version */
const LOCK_VERSION = 1;

/** Order of package types in the lock file */
const TYPE_ORDER: PackageType[] = ["tap", "brew", "cask", "mas"];

/**
 * Parse a brew.lock file content into a LockFile structure
 */
export function parseLockFile(content: string): LockFile {
  const entries: LockEntry[] = [];
  let version = LOCK_VERSION;

  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Parse version from header comment
    if (trimmed.startsWith("# brewlock v")) {
      const versionMatch = trimmed.match(/# brewlock v(\d+)/);
      if (versionMatch?.[1]) {
        version = Number.parseInt(versionMatch[1], 10);
      }
      continue;
    }

    // Skip other comments
    if (trimmed.startsWith("#")) continue;

    // Parse entry lines
    const entry = parseEntryLine(trimmed);
    if (entry) {
      entries.push(entry);
    }
  }

  return { version, entries };
}

/**
 * Parse a single entry line from the lock file
 */
function parseEntryLine(line: string): LockEntry | null {
  // Match: type "name"[, key: value]*
  // Examples:
  //   tap "homebrew/cask"
  //   brew "git", version: "2.43.0"
  //   cask "docker", version: "4.26.1"
  //   mas "Xcode", id: 497799835, version: "15.2"

  const typeMatch = line.match(/^(tap|brew|cask|mas)\s+"([^"]+)"/);
  if (!typeMatch) return null;

  const type = typeMatch[1] as PackageType;
  const name = typeMatch[2];

  if (!name) return null;

  const entry: LockEntry = { type, name };

  // Parse optional key: value pairs
  const restOfLine = line.slice(typeMatch[0].length);

  // Parse version
  const versionMatch = restOfLine.match(/version:\s*"([^"]+)"/);
  if (versionMatch?.[1]) {
    entry.version = versionMatch[1];
  }

  // Parse id (for mas)
  const idMatch = restOfLine.match(/id:\s*(\d+)/);
  if (idMatch?.[1]) {
    entry.id = Number.parseInt(idMatch[1], 10);
  }

  return entry;
}

/**
 * Serialize a LockFile structure to brew.lock file format
 */
export function serializeLockFile(lockFile: LockFile): string {
  const lines: string[] = [`# brewlock v${lockFile.version}`];

  // Group entries by type and sort
  const grouped = new Map<PackageType, LockEntry[]>();
  for (const type of TYPE_ORDER) {
    grouped.set(type, []);
  }

  for (const entry of lockFile.entries) {
    grouped.get(entry.type)?.push(entry);
  }

  let lastType: PackageType | null = null;

  for (const type of TYPE_ORDER) {
    const entries = grouped.get(type) ?? [];
    if (entries.length === 0) continue;

    // Add blank line between different types
    if (lastType !== null) {
      lines.push("");
    }

    for (const entry of entries) {
      lines.push(serializeEntry(entry));
    }

    lastType = type;
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Serialize a single lock entry to a line
 */
function serializeEntry(entry: LockEntry): string {
  let line = `${entry.type} "${entry.name}"`;

  if (entry.type === "mas" && entry.id !== undefined) {
    line += `, id: ${entry.id}`;
    if (entry.version) {
      line += `, version: "${entry.version}"`;
    }
  } else if (entry.version) {
    line += `, version: "${entry.version}"`;
  }

  return line;
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
      return { version: LOCK_VERSION, entries: [] };
    }

    const content = await file.text();
    return parseLockFile(content);
  } catch {
    return { version: LOCK_VERSION, entries: [] };
  }
}

/**
 * Write a LockFile to disk
 */
export async function writeLockFile(
  lockFile: LockFile,
  path?: string
): Promise<void> {
  const filePath = path ?? DEFAULT_LOCK_FILE;
  const content = serializeLockFile(lockFile);
  await Bun.write(filePath, content);
}

/**
 * Add or update an entry in the lock file
 */
export function upsertEntry(lockFile: LockFile, entry: LockEntry): LockFile {
  const entries = [...lockFile.entries];

  // Find existing entry with same type and name
  const existingIndex = entries.findIndex(
    (e) => e.type === entry.type && e.name === entry.name
  );

  if (existingIndex >= 0) {
    // Update existing entry
    entries[existingIndex] = { ...entry };
  } else {
    // Add new entry in the correct position based on type order
    const typeIndex = TYPE_ORDER.indexOf(entry.type);
    let insertIndex = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const currentEntry = entries[i];
      if (!currentEntry) continue;
      const currentTypeIndex = TYPE_ORDER.indexOf(currentEntry.type);
      if (currentTypeIndex > typeIndex) {
        insertIndex = i;
        break;
      }
    }

    entries.splice(insertIndex, 0, { ...entry });
  }

  return { ...lockFile, entries };
}

/**
 * Remove an entry from the lock file
 */
export function removeEntry(
  lockFile: LockFile,
  type: LockEntry["type"],
  name: string
): LockFile {
  const entries = lockFile.entries.filter(
    (e) => !(e.type === type && e.name === name)
  );

  return { ...lockFile, entries };
}

/**
 * Generate a lock file from currently installed packages
 */
export async function generateLockFile(): Promise<LockFile> {
  const entries: LockEntry[] = [];

  // Get all taps
  const taps = await getAllTaps();
  for (const tap of taps) {
    entries.push({ type: "tap", name: tap });
  }

  // Get all installed formulae
  const formulae = await getAllInstalledFormulae();
  for (const formula of formulae) {
    entries.push({
      type: "brew",
      name: formula.name,
      version: formula.version,
    });
  }

  // Get all installed casks
  const casks = await getAllInstalledCasks();
  for (const cask of casks) {
    entries.push({
      type: "cask",
      name: cask.name,
      version: cask.version,
    });
  }

  // Get all mas apps
  const masApps = await getMasApps();
  for (const app of masApps) {
    entries.push({
      type: "mas",
      name: app.name,
      version: app.version,
      id: app.id,
    });
  }

  return {
    version: 1,
    entries,
  };
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

  for (const entry of lockFile.entries) {
    // Skip taps (they don't have versions)
    if (entry.type === "tap") continue;

    const expectedVersion = entry.version;
    if (!expectedVersion) continue;

    const actualVersion = await getPackageVersion(entry.type, entry.name);

    if (actualVersion !== expectedVersion) {
      mismatches.push({
        name: entry.name,
        expected: expectedVersion,
        actual: actualVersion,
      });
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}
