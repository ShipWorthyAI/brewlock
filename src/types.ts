/**
 * Types for brewlock - a version-locking wrapper for Homebrew
 */

/** Package types supported by Homebrew */
export type PackageType = "tap" | "brew" | "cask" | "mas";

/** Represents a single entry in the brew.lock file */
export interface LockEntry {
  type: PackageType;
  name: string;
  version?: string;
  /** For mas apps, the App Store ID */
  id?: number;
}

/** Parsed brew.lock file */
export interface LockFile {
  /** Header comment version */
  version: number;
  entries: LockEntry[];
}

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

/** Version info for an installed package */
export interface InstalledPackage {
  name: string;
  version: string;
  type: PackageType;
  /** For mas apps */
  id?: number;
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
