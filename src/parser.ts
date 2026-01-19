/**
 * Command parser for brew CLI arguments
 */

import type { ParsedCommand } from "./types.ts";

/** Commands that modify installed packages */
const MODIFYING_COMMANDS = new Set([
  "install",
  "uninstall",
  "remove",
  "rm",
  "upgrade",
  "tap",
  "untap",
  "reinstall",
]);

/** Bundle subcommands that modify packages */
const MODIFYING_BUNDLE_SUBCOMMANDS = new Set(["install", "cleanup"]);

/**
 * Check if a command modifies installed packages
 */
export function isModifyingCommand(command: string): boolean {
  return MODIFYING_COMMANDS.has(command);
}

/**
 * Parse brew command line arguments into a structured format
 */
export function parseCommand(args: string[]): ParsedCommand {
  if (args.length === 0) {
    return {
      command: "",
      isCask: false,
      packages: [],
      args: [],
      modifiesPackages: false,
      isBundle: false,
    };
  }

  // Find the main command (skip leading flags like --verbose)
  let commandIndex = 0;
  while (commandIndex < args.length && args[commandIndex]?.startsWith("-")) {
    commandIndex++;
  }

  const command = args[commandIndex] ?? "";
  const remainingArgs = args.slice(commandIndex + 1);

  // Check for --cask or --formula flags
  let isCask = false;
  const filteredArgs: string[] = [];
  const packages: string[] = [];

  for (const arg of remainingArgs) {
    if (arg === "--cask") {
      isCask = true;
    } else if (arg === "--formula") {
      isCask = false;
    } else if (arg.startsWith("-")) {
      filteredArgs.push(arg);
    } else {
      packages.push(arg);
    }
  }

  // Handle bundle commands
  if (command === "bundle") {
    const subcommand =
      packages[0] && !packages[0].startsWith("-") ? packages[0] : "install";
    const isModifyingBundle = MODIFYING_BUNDLE_SUBCOMMANDS.has(subcommand);

    return {
      command,
      subcommand,
      isCask: false,
      packages: packages.slice(1),
      args,
      modifiesPackages: isModifyingBundle,
      isBundle: true,
    };
  }

  // Handle tap command (no args = list, with args = add tap)
  if (command === "tap") {
    const modifiesPackages = packages.length > 0;
    return {
      command,
      isCask: false,
      packages,
      args,
      modifiesPackages,
      isBundle: false,
    };
  }

  // Determine if this command modifies packages
  const modifiesPackages = isModifyingCommand(command);

  return {
    command,
    isCask,
    packages,
    args,
    modifiesPackages,
    isBundle: false,
  };
}
