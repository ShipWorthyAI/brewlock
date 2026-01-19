/**
 * Version resolver - queries installed package versions from Homebrew
 */

import { executeBrewCommand } from "./executor.ts";
import type { InstalledPackage, PackageType, TapInfo } from "./types.ts";

/**
 * Get the current platform identifier for bottle lookups
 * Maps to Homebrew's bottle file keys (e.g., "arm64_sonoma", "ventura")
 */
function getCurrentPlatform(): string {
  const arch = process.arch === "arm64" ? "arm64_" : "";
  // Map common macOS versions to Homebrew's naming
  const release = process.platform === "darwin" ? "sonoma" : "linux";
  return `${arch}${release}`;
}

/** JSON structure for brew info --json=v2 formula output */
interface BrewFormulaInfo {
  formulae: Array<{
    name: string;
    full_name: string;
    tap: string;
    versions: {
      stable: string;
      head: string | null;
    };
    revision: number;
    dependencies: string[];
    linked_keg: string | null;
    pinned: boolean;
    bottle: {
      stable?: {
        files: Record<
          string,
          {
            url: string;
            sha256: string;
          }
        >;
      };
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
    tap: string;
    sha256: string | null;
    auto_updates: boolean | null;
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

    // Return linked_keg if available, otherwise first installed version
    return formula.linked_keg ?? formula.installed[0]?.version ?? null;
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
 * Get all installed formulae with versions and metadata
 */
export async function getAllInstalledFormulae(): Promise<InstalledPackage[]> {
  const result = await executeBrewCommand(["info", "--json=v2", "--installed"]);

  if (!result.success) {
    return [];
  }

  try {
    const info = JSON.parse(result.stdout) as BrewFormulaInfo;
    const packages: InstalledPackage[] = [];
    const platform = getCurrentPlatform();

    for (const formula of info.formulae) {
      if (formula.installed.length > 0) {
        // Use linked_keg as the active version, fallback to first installed
        const activeVersion =
          formula.linked_keg ?? formula.installed[0]?.version;
        if (!activeVersion) continue;

        // Find the installed entry that matches the active version for metadata
        const activeInstalled = formula.installed.find(
          (i) => i.version === activeVersion
        );

        // Collect all installed versions
        const installedVersions = formula.installed.map((i) => i.version);

        // Get bottle SHA256 for current platform
        const bottleSha256 =
          formula.bottle?.stable?.files?.[platform]?.sha256 ?? undefined;

        packages.push({
          name: formula.name,
          version: activeVersion,
          type: "brew",
          installed: installedVersions,
          revision: formula.revision > 0 ? formula.revision : undefined,
          tap: formula.tap || undefined,
          pinned: formula.pinned || undefined,
          dependencies:
            formula.dependencies.length > 0 ? formula.dependencies : undefined,
          sha256: bottleSha256,
          installed_as_dependency: activeInstalled?.installed_as_dependency,
          installed_on_request: activeInstalled?.installed_on_request,
        });
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
          tap: cask.tap || undefined,
          sha256: cask.sha256 ?? undefined,
          auto_updates: cask.auto_updates ?? undefined,
        });
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/** JSON structure for brew tap-info --json output */
interface BrewTapInfo {
  name: string;
  HEAD?: string;
  remote: string;
  installed: boolean;
  official: boolean;
  formula_names: string[];
  cask_tokens: string[];
}

/**
 * Get all taps (names only)
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
 * Get all taps with detailed info (URL, commit, official)
 */
export async function getAllTapsWithInfo(): Promise<TapInfo[]> {
  // First get the list of taps
  const tapNames = await getAllTaps();

  if (tapNames.length === 0) {
    return [];
  }

  // Get detailed info for all taps
  const result = await executeBrewCommand(["tap-info", "--json", ...tapNames]);

  if (!result.success) {
    // Fall back to basic tap info without URL/commit
    return tapNames.map((name) => ({ name }));
  }

  try {
    const tapInfos = JSON.parse(result.stdout) as BrewTapInfo[];
    const taps: TapInfo[] = [];

    for (const tapInfo of tapInfos) {
      const tap: TapInfo = {
        name: tapInfo.name,
        official: tapInfo.official || undefined,
      };

      // Include URL for non-official taps (custom repos)
      if (tapInfo.remote && !tapInfo.official) {
        tap.url = tapInfo.remote;
      }

      if (tapInfo.HEAD) {
        tap.commit = tapInfo.HEAD;
      } else {
        // Get commit SHA from the tap's git directory
        const commit = await getTapCommit(tapInfo.name);
        if (commit) {
          tap.commit = commit;
        }
      }

      taps.push(tap);
    }

    return taps;
  } catch {
    return tapNames.map((name) => ({ name }));
  }
}

/**
 * Get the current commit SHA for a tap
 */
async function getTapCommit(tapName: string): Promise<string | null> {
  try {
    // Tap directories are located at $(brew --repository)/Library/Taps/<user>/<repo>
    const repoResult = await executeBrewCommand(["--repository"]);
    if (!repoResult.success) {
      return null;
    }

    const brewRepo = repoResult.stdout.trim();
    const tapPath = `${brewRepo}/Library/Taps/${tapName}`;

    // Get the current HEAD commit
    const proc = Bun.spawn(["git", "-C", tapPath, "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return null;
    }

    return stdout.trim() || null;
  } catch {
    return null;
  }
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
