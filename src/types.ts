/**
 * Types for brewlock - a version-locking wrapper for Homebrew
 */

import { z } from "zod";

/** Package types supported by Homebrew */
export type PackageType = "tap" | "brew" | "cask" | "mas";

// =============================================================================
// Lock File Schemas (Zod) - single source of truth
// =============================================================================

/**
 * Schema for a tap entry in the lock file
 * @property url - Custom GitHub repo URL for non-standard taps
 * @property commit - Git commit SHA for reproducibility
 * @property official - Whether this is an official Homebrew tap
 */
export const TapEntrySchema = z.object({
  url: z.string().optional(),
  commit: z.string().optional(),
  official: z.boolean().optional(),
});

/**
 * Schema for a brew formula entry in the lock file
 * @property version - Linked (active) version
 * @property installed - All installed versions in the Cellar
 * @property revision - Formula revision (distinguishes 2.43.0 from 2.43.0_1)
 * @property tap - Source tap (e.g., "homebrew/core")
 * @property pinned - Whether the formula is pinned
 * @property dependencies - Direct dependencies
 * @property sha256 - Platform-specific bottle SHA256
 * @property installed_as_dependency - Whether installed as a dependency
 * @property installed_on_request - Whether user explicitly installed it
 */
export const BrewEntrySchema = z.object({
  version: z.string(),
  installed: z.array(z.string()).optional(),
  revision: z.number().optional(),
  tap: z.string().optional(),
  pinned: z.boolean().optional(),
  dependencies: z.array(z.string()).optional(),
  sha256: z.string().optional(),
  installed_as_dependency: z.boolean().optional(),
  installed_on_request: z.boolean().optional(),
});

/**
 * Schema for a cask entry in the lock file
 * @property version - Installed version
 * @property tap - Source tap (e.g., "homebrew/cask")
 * @property sha256 - Download SHA256
 * @property auto_updates - Whether the app self-updates
 */
export const CaskEntrySchema = z.object({
  version: z.string(),
  tap: z.string().optional(),
  sha256: z.string().optional(),
  auto_updates: z.boolean().optional(),
});

/**
 * Schema for a Mac App Store app entry in the lock file
 * @property id - App Store ID
 * @property version - Installed version
 */
export const MasEntrySchema = z.object({
  id: z.number(),
  version: z.string(),
});

/**
 * Schema for the complete lock file
 * @property version - Lock file format version
 * @property tap - Taps keyed by name
 * @property brew - Brew formulae keyed by name
 * @property cask - Casks keyed by name
 * @property mas - Mac App Store apps keyed by name
 */
export const LockFileSchema = z.object({
  version: z.number(),
  tap: z.record(z.string(), TapEntrySchema),
  brew: z.record(z.string(), BrewEntrySchema),
  cask: z.record(z.string(), CaskEntrySchema),
  mas: z.record(z.string(), MasEntrySchema),
});

// =============================================================================
// Lock File Types (inferred from Zod schemas)
// =============================================================================

/** Entry for a tap in the lock file */
export type TapEntry = z.infer<typeof TapEntrySchema>;

/** Entry for a brew formula in the lock file */
export type BrewEntry = z.infer<typeof BrewEntrySchema>;

/** Entry for a cask in the lock file */
export type CaskEntry = z.infer<typeof CaskEntrySchema>;

/** Entry for a Mac App Store app in the lock file */
export type MasEntry = z.infer<typeof MasEntrySchema>;

/** Parsed brew.lock file (JSONC format) */
export type LockFile = z.infer<typeof LockFileSchema>;

// =============================================================================
// Command Types
// =============================================================================

/** Brew command types that modify packages */
export type ModifyingCommand =
  | "install"
  | "uninstall"
  | "remove"
  | "rm"
  | "upgrade"
  | "tap"
  | "untap";

/** Brew bundle subcommands */
export type BundleSubcommand =
  | "install"
  | "dump"
  | "cleanup"
  | "check"
  | "list"
  | "exec";

/** Parsed brew command */
export interface ParsedCommand {
  /** The main brew command (install, uninstall, upgrade, etc.) */
  command: string;
  /** For bundle commands, the subcommand */
  subcommand?: string;
  /** Whether this is a cask operation */
  isCask: boolean;
  /** Package names specified */
  packages: string[];
  /** All original arguments (for passthrough) */
  args: string[];
  /** Whether this command modifies installed packages */
  modifiesPackages: boolean;
  /** Whether this is a bundle command */
  isBundle: boolean;
}

/** Result of executing a brew command */
export interface ExecutionResult {
  /** Exit code from the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded (exit code 0) */
  success: boolean;
}

// =============================================================================
// Internal Types (for version resolver)
// =============================================================================

/** Version info for an installed package */
export interface InstalledPackage {
  name: string;
  version: string;
  type: PackageType;
  /** For mas apps */
  id?: number;
  /** All installed versions (brew only) */
  installed?: string[];
  /** Formula revision (brew only) */
  revision?: number;
  /** Source tap */
  tap?: string;
  /** Whether pinned (brew only) */
  pinned?: boolean;
  /** Direct dependencies (brew only) */
  dependencies?: string[];
  /** SHA256 (bottle SHA256 for brew, download SHA256 for cask) */
  sha256?: string;
  /** Whether installed as a dependency (brew only) */
  installed_as_dependency?: boolean;
  /** Whether user explicitly installed it (brew only) */
  installed_on_request?: boolean;
  /** Whether the app self-updates (cask only) */
  auto_updates?: boolean;
}

/** Tap info with URL and commit */
export interface TapInfo {
  name: string;
  /** Custom GitHub repo URL for non-standard taps */
  url?: string;
  /** Git commit SHA */
  commit?: string;
  /** Whether this is an official Homebrew tap */
  official?: boolean;
}

/** Options for bundle install */
export interface BundleInstallOptions {
  /** Path to the lock file */
  lockFilePath: string;
  /** Whether to fail on version mismatch */
  strict?: boolean;
  /** Verbose output */
  verbose?: boolean;
}
