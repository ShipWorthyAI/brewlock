/**
 * Bundle handler for version-locked installations
 * Optimized for performance with batch version checking and parallel installs
 */

import { executeBrewCommandStreaming } from "./executor.ts";
import { readLockFile } from "./lock-manager.ts";
import { measurePerformance } from "./performance.ts";
import type {
  BrewEntry,
  BundleInstallOptions,
  CaskEntry,
  InstalledPackage,
  MasEntry,
  TapEntry,
} from "./types.ts";
import {
  getAllInstalledCasks,
  getAllInstalledFormulae,
  getAllTaps,
  getMasApps,
} from "./version-resolver.ts";

/** Default concurrency for parallel installations */
const DEFAULT_CONCURRENCY = 4;

/** Result status for an individual package installation */
type InstallStatus = "installed" | "skipped" | "failed";

/** Result of installing a package */
interface InstallResult {
  name: string;
  status: InstallStatus;
}

/** Summary counts for installation results */
interface InstallSummary {
  installed: number;
  skipped: number;
  failed: number;
}

/**
 * Execute async operations with controlled concurrency
 * @param items - Items to process
 * @param concurrency - Maximum number of concurrent operations
 * @param fn - Async function to execute for each item
 * @returns Array of results in order of completion
 */
async function parallelLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
      executing.delete(p);
    });
    executing.add(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Install packages from a lock file with version constraints
 * Optimized with batch version checking and parallel installations
 */
export async function bundleInstall(
  options: BundleInstallOptions
): Promise<boolean> {
  return measurePerformance(
    "bundleInstall",
    {
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      lockFilePath: options.lockFilePath,
      strict: options.strict ?? false,
      verbose: options.verbose ?? false,
    },
    () => bundleInstallInternal(options)
  );
}

async function bundleInstallInternal(
  options: BundleInstallOptions
): Promise<boolean> {
  const {
    lockFilePath,
    strict = false,
    verbose = false,
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  // Read the lock file
  const lockFile = await readLockFile(lockFilePath);

  const tapEntries = Object.entries(lockFile.tap);
  const brewEntries = Object.entries(lockFile.brew);
  const caskEntries = Object.entries(lockFile.cask);
  const masEntries = Object.entries(lockFile.mas);

  const hasTaps = tapEntries.length > 0;
  const hasBrews = brewEntries.length > 0;
  const hasCasks = caskEntries.length > 0;
  const hasMas = masEntries.length > 0;

  if (!hasTaps && !hasBrews && !hasCasks && !hasMas) {
    if (verbose) {
      console.log("No packages in lock file.");
    }
    return true;
  }

  // Fetch all installed packages upfront (3-4 commands total instead of N)
  if (verbose) {
    console.log("Fetching installed packages...");
  }

  const [installedFormulae, installedCasks, installedTaps, installedMas] =
    await Promise.all([
      hasBrews ? getAllInstalledFormulae() : Promise.resolve([]),
      hasCasks ? getAllInstalledCasks() : Promise.resolve([]),
      hasTaps ? getAllTaps() : Promise.resolve([]),
      hasMas ? getMasApps() : Promise.resolve([]),
    ]);

  // Build lookup maps for O(1) version checking
  const formulaeVersions = new Map<string, string>(
    installedFormulae.map((f) => [f.name, f.version])
  );
  const caskVersions = new Map<string, string>(
    installedCasks.map((c) => [c.name, c.version])
  );
  const tapSet = new Set<string>(installedTaps);
  const masVersions = new Map<string, InstalledPackage>(
    installedMas.map((m) => [m.name.toLowerCase(), m])
  );

  let allSuccess = true;

  // Track results for summary
  const summary = {
    taps: { installed: 0, skipped: 0, failed: 0 } as InstallSummary,
    formulae: { installed: 0, skipped: 0, failed: 0 } as InstallSummary,
    casks: { installed: 0, skipped: 0, failed: 0 } as InstallSummary,
    mas: { installed: 0, skipped: 0, failed: 0 } as InstallSummary,
  };

  // Install taps first (must complete before formulae that depend on them)
  if (hasTaps) {
    if (verbose) {
      console.log(`Installing ${tapEntries.length} tap(s)...`);
    }

    const tapResults = await parallelLimit(
      tapEntries,
      concurrency,
      async ([name, entry]) => {
        return installTap(name, entry, tapSet, verbose);
      }
    );

    for (const result of tapResults) {
      summary.taps[result.status]++;
      if (result.status === "failed") {
        allSuccess = false;
        if (strict) {
          printSummary(summary);
          return false;
        }
      }
    }
  }

  // Install brew formulae in parallel
  if (hasBrews) {
    if (verbose) {
      console.log(`Installing ${brewEntries.length} formula(e)...`);
    }

    const brewResults = await parallelLimit(
      brewEntries,
      concurrency,
      async ([name, entry]) => {
        return installBrew(name, entry, formulaeVersions, strict, verbose);
      }
    );

    for (const result of brewResults) {
      summary.formulae[result.status]++;
      if (result.status === "failed") {
        allSuccess = false;
        if (strict) {
          printSummary(summary);
          return false;
        }
      }
    }
  }

  // Install casks in parallel
  if (hasCasks) {
    if (verbose) {
      console.log(`Installing ${caskEntries.length} cask(s)...`);
    }

    const caskResults = await parallelLimit(
      caskEntries,
      concurrency,
      async ([name, entry]) => {
        return installCask(name, entry, caskVersions, strict, verbose);
      }
    );

    for (const result of caskResults) {
      summary.casks[result.status]++;
      if (result.status === "failed") {
        allSuccess = false;
        if (strict) {
          printSummary(summary);
          return false;
        }
      }
    }
  }

  // Install Mac App Store apps in parallel
  if (hasMas) {
    if (verbose) {
      console.log(`Installing ${masEntries.length} App Store app(s)...`);
    }

    const masResults = await parallelLimit(
      masEntries,
      concurrency,
      async ([name, entry]) => {
        return installMas(name, entry, masVersions, strict, verbose);
      }
    );

    for (const result of masResults) {
      summary.mas[result.status]++;
      if (result.status === "failed") {
        allSuccess = false;
        if (strict) {
          printSummary(summary);
          return false;
        }
      }
    }
  }

  // Print final summary
  printSummary(summary);

  return allSuccess;
}

/**
 * Print installation summary
 */
function printSummary(summary: {
  taps: InstallSummary;
  formulae: InstallSummary;
  casks: InstallSummary;
  mas: InstallSummary;
}): void {
  const totalInstalled =
    summary.taps.installed +
    summary.formulae.installed +
    summary.casks.installed +
    summary.mas.installed;
  const totalSkipped =
    summary.taps.skipped +
    summary.formulae.skipped +
    summary.casks.skipped +
    summary.mas.skipped;
  const totalFailed =
    summary.taps.failed +
    summary.formulae.failed +
    summary.casks.failed +
    summary.mas.failed;

  // Don't print anything if there's nothing to report
  if (totalInstalled === 0 && totalSkipped === 0 && totalFailed === 0) {
    return;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("Bundle Install Summary");
  console.log("=".repeat(50));

  const lines: string[] = [];

  // Build summary lines for each type with counts
  if (
    summary.taps.installed > 0 ||
    summary.taps.skipped > 0 ||
    summary.taps.failed > 0
  ) {
    lines.push(formatSummaryLine("Taps", summary.taps));
  }
  if (
    summary.formulae.installed > 0 ||
    summary.formulae.skipped > 0 ||
    summary.formulae.failed > 0
  ) {
    lines.push(formatSummaryLine("Formulae", summary.formulae));
  }
  if (
    summary.casks.installed > 0 ||
    summary.casks.skipped > 0 ||
    summary.casks.failed > 0
  ) {
    lines.push(formatSummaryLine("Casks", summary.casks));
  }
  if (
    summary.mas.installed > 0 ||
    summary.mas.skipped > 0 ||
    summary.mas.failed > 0
  ) {
    lines.push(formatSummaryLine("App Store", summary.mas));
  }

  for (const line of lines) {
    console.log(line);
  }

  console.log("-".repeat(50));

  // Total line
  const parts: string[] = [];
  if (totalInstalled > 0) {
    parts.push(`${totalInstalled} installed`);
  }
  if (totalSkipped > 0) {
    parts.push(`${totalSkipped} up-to-date`);
  }
  if (totalFailed > 0) {
    parts.push(`${totalFailed} failed`);
  }

  if (parts.length > 0) {
    console.log(`Total: ${parts.join(", ")}`);
  }

  if (totalFailed === 0) {
    console.log("\nAll packages processed successfully.");
  } else {
    console.log(`\nCompleted with ${totalFailed} error(s).`);
  }
}

/**
 * Format a summary line for a package type
 */
function formatSummaryLine(label: string, counts: InstallSummary): string {
  const parts: string[] = [];

  if (counts.installed > 0) {
    parts.push(`${counts.installed} installed`);
  }
  if (counts.skipped > 0) {
    parts.push(`${counts.skipped} up-to-date`);
  }
  if (counts.failed > 0) {
    parts.push(`${counts.failed} failed`);
  }

  return `  ${label.padEnd(12)} ${parts.join(", ")}`;
}

/**
 * Install a tap using pre-fetched tap list
 */
async function installTap(
  name: string,
  entry: TapEntry,
  installedTaps: Set<string>,
  verbose: boolean
): Promise<InstallResult> {
  // Check if tap is already added using pre-fetched set
  if (installedTaps.has(name)) {
    if (verbose) {
      console.log(`Tap ${name} already added.`);
    }
    return { name, status: "skipped" };
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
  return { name, status: result.success ? "installed" : "failed" };
}

/**
 * Install a brew formula using pre-fetched version map
 */
async function installBrew(
  name: string,
  entry: BrewEntry,
  installedVersions: Map<string, string>,
  strict: boolean,
  verbose: boolean
): Promise<InstallResult> {
  const currentVersion = installedVersions.get(name) ?? null;

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`brew ${name} already at version ${entry.version}.`);
    }
    return { name, status: "skipped" };
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return { name, status: "failed" };
    }
  }

  if (verbose) {
    console.log(`Installing brew ${name}...`);
  }

  const result = await executeBrewCommandStreaming(["install", name]);
  return { name, status: result.success ? "installed" : "failed" };
}

/**
 * Install a cask using pre-fetched version map
 */
async function installCask(
  name: string,
  entry: CaskEntry,
  installedVersions: Map<string, string>,
  strict: boolean,
  verbose: boolean
): Promise<InstallResult> {
  const currentVersion = installedVersions.get(name) ?? null;

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`cask ${name} already at version ${entry.version}.`);
    }
    return { name, status: "skipped" };
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return { name, status: "failed" };
    }
  }

  if (verbose) {
    console.log(`Installing cask ${name}...`);
  }

  const result = await executeBrewCommandStreaming(["install", "--cask", name]);
  return { name, status: result.success ? "installed" : "failed" };
}

/**
 * Install a Mac App Store app using pre-fetched version map
 */
async function installMas(
  name: string,
  entry: MasEntry,
  installedApps: Map<string, InstalledPackage>,
  strict: boolean,
  verbose: boolean
): Promise<InstallResult> {
  const installedApp = installedApps.get(name.toLowerCase());
  const currentVersion = installedApp?.version ?? null;

  if (currentVersion === entry.version) {
    if (verbose) {
      console.log(`mas ${name} already at version ${entry.version}.`);
    }
    return { name, status: "skipped" };
  }

  if (currentVersion !== null && currentVersion !== entry.version) {
    console.warn(
      `Warning: ${name} is at version ${currentVersion}, but lock file specifies ${entry.version}`
    );
    if (strict) {
      console.error(`Strict mode: version mismatch for ${name}`);
      return { name, status: "failed" };
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
    return { name, status: exitCode === 0 ? "installed" : "failed" };
  } catch {
    return { name, status: "failed" };
  }
}
