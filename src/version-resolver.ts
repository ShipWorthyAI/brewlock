/**
 * Version resolver - queries installed package versions from Homebrew
 */

import { executeBrewCommand } from "./executor.ts";
import type { InstalledPackage, PackageType } from "./types.ts";

/** JSON structure for brew info --json=v2 formula output */
interface BrewFormulaInfo {
  formulae: Array<{
    name: string;
    full_name: string;
    versions: {
      stable: string;
      head: string | null;
    };
    installed: Array<{
      version: string;
      installed_as_dependency: boolean;
      installed_on_request: boolean;
    }>;
  }>;
}

/** JSON structure for brew info --cask --json=v2 output */
interface BrewCaskInfo {
  casks: Array<{
    token: string;
    name: string[];
    version: string;
    installed: string | null;
  }>;
}

/**
 * Get the installed version of a formula
 */
export async function getFormulaVersion(name: string): Promise<string | null> {
  const result = await executeBrewCommand(["info", "--json=v2", name]);

  if (!result.success) {
    return null;
  }

  try {
    const info = JSON.parse(result.stdout) as BrewFormulaInfo;
    const formula = info.formulae[0];

    if (!formula || formula.installed.length === 0) {
      return null;
    }

    // Return the first installed version (most recently installed)
    return formula.installed[0]?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the installed version of a cask
 */
export async function getCaskVersion(name: string): Promise<string | null> {
  const result = await executeBrewCommand([
    "info",
    "--cask",
    "--json=v2",
    name,
  ]);

  if (!result.success) {
    return null;
  }

  try {
    const info = JSON.parse(result.stdout) as BrewCaskInfo;
    const cask = info.casks[0];

    if (!cask || !cask.installed) {
      return null;
    }

    return cask.installed;
  } catch {
    return null;
  }
}

/**
 * Get all installed formulae with versions
 */
export async function getAllInstalledFormulae(): Promise<InstalledPackage[]> {
  const result = await executeBrewCommand(["info", "--json=v2", "--installed"]);

  if (!result.success) {
    return [];
  }

  try {
    const info = JSON.parse(result.stdout) as BrewFormulaInfo;
    const packages: InstalledPackage[] = [];

    for (const formula of info.formulae) {
      if (formula.installed.length > 0) {
        const version = formula.installed[0]?.version;
        if (version) {
          packages.push({
            name: formula.name,
            version,
            type: "brew",
          });
        }
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/**
 * Get all installed casks with versions
 */
export async function getAllInstalledCasks(): Promise<InstalledPackage[]> {
  const result = await executeBrewCommand([
    "info",
    "--cask",
    "--json=v2",
    "--installed",
  ]);

  if (!result.success) {
    return [];
  }

  try {
    const info = JSON.parse(result.stdout) as BrewCaskInfo;
    const packages: InstalledPackage[] = [];

    for (const cask of info.casks) {
      if (cask.installed) {
        packages.push({
          name: cask.token,
          version: cask.installed,
          type: "cask",
        });
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/**
 * Get all taps
 */
export async function getAllTaps(): Promise<string[]> {
  const result = await executeBrewCommand(["tap"]);

  if (!result.success) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Get installed mas apps with versions
 */
export async function getMasApps(): Promise<InstalledPackage[]> {
  // Check if mas is available
  const masCheck = await executeBrewCommand(["list", "--formula", "mas"]);

  if (!masCheck.success) {
    // mas is not installed
    return [];
  }

  try {
    // Use mas list to get installed apps
    const proc = Bun.spawn(["mas", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return [];
    }

    const packages: InstalledPackage[] = [];
    const lines = stdout.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      // Format: "497799835 Xcode (15.2)"
      const match = line.match(/^(\d+)\s+(.+?)\s+\(([^)]+)\)$/);
      if (match) {
        const id = Number.parseInt(match[1] ?? "0", 10);
        const name = match[2]?.trim() ?? "";
        const version = match[3]?.trim() ?? "";

        if (id && name && version) {
          packages.push({
            name,
            version,
            type: "mas",
            id,
          });
        }
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/**
 * Get the version of a package by type and name
 */
export async function getPackageVersion(
  type: PackageType,
  name: string
): Promise<string | null> {
  switch (type) {
    case "brew":
      return getFormulaVersion(name);
    case "cask":
      return getCaskVersion(name);
    case "tap":
      // Taps don't have versions
      return null;
    case "mas": {
      // For mas, we need to search by name
      const apps = await getMasApps();
      const app = apps.find((a) => a.name.toLowerCase() === name.toLowerCase());
      return app?.version ?? null;
    }
    default:
      return null;
  }
}
