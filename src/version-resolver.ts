/**
 * Version resolver - queries installed package versions from Homebrew
 */

import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { executeBrewCommand } from "./executor.ts";
import { measurePerformance, type PerformanceSpan } from "./performance.ts";
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

interface FormulaInstallReceipt {
  installed_on_request?: boolean;
  runtime_dependencies?: Array<{
    full_name?: string;
    declared_directly?: boolean;
  }>;
  source?: {
    tap?: string;
    versions?: {
      stable?: string;
    };
  };
}

interface FormulaApiMetadata {
  stable_dependencies?: unknown[];
  stable_version?: string;
  bottle_checksum?: string;
}

interface FormulaApiCache {
  bottleTag?: string;
  formulae: Record<string, FormulaApiMetadata>;
}

type FormulaInfoBackend = "brew" | "local";

interface LocalFormulaInfoResult {
  complete: boolean;
  packages: InstalledPackage[];
}

type VersionResolverSpan = Pick<
  PerformanceSpan,
  "setAttribute" | "setAttributes"
>;

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

interface CaskInstallReceipt {
  source?: {
    tap?: string;
    version?: string;
  };
}

interface CaskApiMetadata {
  token?: string;
  tap?: string;
  version?: string;
  sha256?: string | null;
  auto_updates?: boolean | null;
}

interface CaskApiCache {
  casks: Map<string, CaskApiMetadata>;
  tokens: string[];
}

type CaskInfoBackend = "brew" | "local";

interface LocalCaskInfoResult {
  complete: boolean;
  packages: InstalledPackage[];
}

/**
 * Get the installed version of a formula
 */
export async function getFormulaVersion(name: string): Promise<string | null> {
  return measurePerformance(
    "versionResolver.getFormulaVersion",
    { name },
    async (span) => {
      const backend = getFormulaInfoBackend();
      span.setAttribute("backend", backend);

      if (backend === "local") {
        const version = await getFormulaVersionFromLocalState(name);
        span.setAttributes({
          localFound: version !== null,
          localVersion: version ?? undefined,
        });

        if (version !== null) {
          span.setAttributes({
            found: true,
            source: "local",
            version,
          });
          return version;
        }

        span.setAttribute("fallbackBackend", "brew");
      }

      return getFormulaVersionFromBrewInfo(name, span);
    }
  );
}

async function getFormulaVersionFromBrewInfo(
  name: string,
  span: VersionResolverSpan
): Promise<string | null> {
  const result = await executeBrewCommand(["info", "--json=v2", name]);
  span.setAttribute("brewExitCode", result.exitCode);

  if (!result.success) {
    span.setAttribute("found", false);
    return null;
  }

  try {
    const info = JSON.parse(result.stdout) as BrewFormulaInfo;
    const formula = info.formulae[0];

    if (!formula || formula.installed.length === 0) {
      span.setAttribute("found", false);
      return null;
    }

    // Return linked_keg if available, otherwise first installed version
    const version = formula.linked_keg ?? formula.installed[0]?.version ?? null;
    span.setAttributes({
      found: version !== null,
      source: "brew",
      version: version ?? undefined,
    });
    return version;
  } catch {
    span.setAttribute("parseError", true);
    return null;
  }
}

async function getFormulaVersionFromLocalState(
  name: string
): Promise<string | null> {
  const token = getHomebrewToken(name);

  return measurePerformance(
    "versionResolver.getFormulaVersionFromLocalState",
    { name, token },
    async (span) => {
      const prefixResult = await executeBrewCommand(["--prefix"]);
      span.setAttribute("prefixExitCode", prefixResult.exitCode);

      if (!prefixResult.success) {
        span.setAttribute("found", false);
        return null;
      }

      const prefix = prefixResult.stdout.trim();
      const cellarPath = join(prefix, "Cellar");
      const linkedPath = join(prefix, "var", "homebrew", "linked");
      span.setAttributes({ cellarPath, linkedPath, prefix });

      const version = await readInstalledFormulaVersion(
        cellarPath,
        linkedPath,
        token
      );

      span.setAttributes({
        found: version !== null,
        version: version ?? undefined,
      });
      return version;
    }
  );
}

async function readInstalledFormulaVersion(
  cellarPath: string,
  linkedPath: string,
  name: string
): Promise<string | null> {
  const formulaPath = join(cellarPath, name);

  try {
    const versionDirs = await Promise.all(
      (await readdir(formulaPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => ({
          name: entry.name,
          mtimeMs: (await stat(join(formulaPath, entry.name))).mtimeMs,
        }))
    );

    if (versionDirs.length === 0) {
      return null;
    }

    const installedVersions = versionDirs.map((entry) => entry.name);
    const linkedVersion = await readLinkedFormulaVersion(
      linkedPath,
      name,
      installedVersions
    );

    if (linkedVersion) {
      return linkedVersion;
    }

    versionDirs.sort(
      (a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name)
    );
    return versionDirs[0]?.name ?? null;
  } catch {
    return null;
  }
}

function getHomebrewToken(name: string): string {
  const parts = name.trim().split("/").filter(Boolean);
  return parts[parts.length - 1] ?? name;
}

/**
 * Get the installed version of a cask
 */
export async function getCaskVersion(name: string): Promise<string | null> {
  return measurePerformance(
    "versionResolver.getCaskVersion",
    { name },
    async (span) => {
      const backend = getCaskInfoBackend();
      span.setAttribute("backend", backend);

      if (backend === "local") {
        const version = await getCaskVersionFromLocalState(name);
        span.setAttributes({
          localFound: version !== null,
          localVersion: version ?? undefined,
        });

        if (version !== null) {
          span.setAttributes({
            found: true,
            source: "local",
            version,
          });
          return version;
        }

        span.setAttribute("fallbackBackend", "brew");
      }

      return getCaskVersionFromBrewInfo(name, span);
    }
  );
}

async function getCaskVersionFromBrewInfo(
  name: string,
  span: VersionResolverSpan
): Promise<string | null> {
  const result = await executeBrewCommand([
    "info",
    "--cask",
    "--json=v2",
    name,
  ]);
  span.setAttribute("brewExitCode", result.exitCode);

  if (!result.success) {
    span.setAttribute("found", false);
    return null;
  }

  try {
    const info = JSON.parse(result.stdout) as BrewCaskInfo;
    const cask = info.casks[0];

    if (!cask || !cask.installed) {
      span.setAttribute("found", false);
      return null;
    }

    span.setAttributes({
      found: true,
      source: "brew",
      version: cask.installed,
    });
    return cask.installed;
  } catch {
    span.setAttribute("parseError", true);
    return null;
  }
}

async function getCaskVersionFromLocalState(
  name: string
): Promise<string | null> {
  const token = getHomebrewToken(name);

  return measurePerformance(
    "versionResolver.getCaskVersionFromLocalState",
    { name, token },
    async (span) => {
      const prefixResult = await executeBrewCommand(["--prefix"]);
      span.setAttribute("prefixExitCode", prefixResult.exitCode);

      if (!prefixResult.success) {
        span.setAttribute("found", false);
        return null;
      }

      const prefix = prefixResult.stdout.trim();
      const caskroomPath = join(prefix, "Caskroom");
      span.setAttributes({ caskroomPath, prefix });

      const version = await readInstalledCaskVersion(caskroomPath, token);
      span.setAttributes({
        found: version !== null,
        version: version ?? undefined,
      });

      return version;
    }
  );
}

/**
 * Get all installed formulae with versions and metadata
 */
export async function getAllInstalledFormulae(): Promise<InstalledPackage[]> {
  return measurePerformance(
    "versionResolver.getAllInstalledFormulae",
    {},
    async (span) => {
      const backend = getFormulaInfoBackend();
      span.setAttribute("backend", backend);

      if (backend === "local") {
        const localResult = await getAllInstalledFormulaeFromLocalState();
        span.setAttributes({
          localComplete: localResult.complete,
          localCount: localResult.packages.length,
        });

        if (localResult.complete) {
          span.setAttribute("count", localResult.packages.length);
          return localResult.packages;
        }

        span.setAttribute("fallbackBackend", "brew");
      }

      return getAllInstalledFormulaeFromBrewInfo(span);
    }
  );
}

function getFormulaInfoBackend(): FormulaInfoBackend {
  const backend = process.env.BREWLOCK_FORMULA_INFO_BACKEND?.trim().toLowerCase();

  return backend === "brew" ? "brew" : "local";
}

async function getAllInstalledFormulaeFromBrewInfo(span: {
  setAttribute(name: string, value: string | number | boolean): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
}): Promise<InstalledPackage[]> {
  const result = await executeBrewCommand(["info", "--json=v2", "--installed"]);
  span.setAttribute("brewExitCode", result.exitCode);

  if (!result.success) {
    span.setAttribute("count", 0);
    return [];
  }

  try {
    const info = JSON.parse(result.stdout) as BrewFormulaInfo;
    const packages: InstalledPackage[] = [];
    const platform = getCurrentPlatform();
    span.setAttribute("platform", platform);

    for (const formula of info.formulae) {
      if (formula.installed.length > 0) {
        // Use linked_keg as the active version, fallback to first installed
        const activeVersion = formula.linked_keg ?? formula.installed[0]?.version;
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

    span.setAttribute("count", packages.length);
    return packages;
  } catch {
    span.setAttributes({
      count: 0,
      parseError: true,
    });
    return [];
  }
}

async function getAllInstalledFormulaeFromLocalState(): Promise<LocalFormulaInfoResult> {
  return measurePerformance(
    "versionResolver.getAllInstalledFormulaeFromLocalState",
    {},
    async (span) => {
      const prefixResult = await executeBrewCommand(["--prefix"]);
      span.setAttribute("prefixExitCode", prefixResult.exitCode);

      if (!prefixResult.success) {
        span.setAttributes({
          complete: false,
          count: 0,
          fallbackReason: "prefixCommandFailed",
        });
        return { complete: false, packages: [] };
      }

      const prefix = prefixResult.stdout.trim();
      const cellarPath = join(prefix, "Cellar");
      const linkedPath = join(prefix, "var", "homebrew", "linked");
      const pinnedPath = join(prefix, "var", "homebrew", "pinned");
      const platform = getCurrentPlatform();
      span.setAttributes({ cellarPath, platform, prefix });

      let formulaNames: string[];
      try {
        formulaNames = (await readdir(cellarPath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
      } catch {
        span.setAttributes({
          complete: false,
          count: 0,
          fallbackReason: "cellarReadFailed",
        });
        return { complete: false, packages: [] };
      }

      const cache = await readFormulaApiCache(platform);
      span.setAttributes({
        formulaApiCacheHit: cache !== null,
        formulaApiCacheBottleTag: cache?.bottleTag,
        formulaApiCacheCount: cache ? Object.keys(cache.formulae).length : 0,
      });

      const packages: InstalledPackage[] = [];
      let missingReceiptCount = 0;
      let pinnedCount = 0;

      for (const name of formulaNames) {
        const formula = await readLocalFormulaInfo({
          cellarPath,
          cache,
          linkedPath,
          name,
          pinnedPath,
          platform,
        });

        if (formula.missingReceipt) {
          missingReceiptCount += 1;
        }
        if (formula.package?.pinned) {
          pinnedCount += 1;
        }
        if (formula.package) {
          packages.push(formula.package);
        }
      }

      span.setAttributes({
        complete: true,
        count: packages.length,
        formulaNameCount: formulaNames.length,
        missingReceiptCount,
        pinnedCount,
      });

      return { complete: true, packages };
    }
  );
}

async function readLocalFormulaInfo({
  cellarPath,
  cache,
  linkedPath,
  name,
  pinnedPath,
  platform,
}: {
  cellarPath: string;
  cache: FormulaApiCache | null;
  linkedPath: string;
  name: string;
  pinnedPath: string;
  platform: string;
}): Promise<{ missingReceipt: boolean; package?: InstalledPackage }> {
  const formulaPath = join(cellarPath, name);
  let installedVersions: string[];

  try {
    installedVersions = (await readdir(formulaPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return { missingReceipt: true };
  }

  if (installedVersions.length === 0) {
    return { missingReceipt: true };
  }

  const activeVersion =
    (await readLinkedFormulaVersion(linkedPath, name, installedVersions)) ??
    installedVersions[0];

  if (!activeVersion) {
    return { missingReceipt: true };
  }

  const receipt = await readInstallReceipt(
    join(formulaPath, activeVersion, "INSTALL_RECEIPT.json")
  );
  const apiFormula = cache?.formulae[name];
  const dependencies =
    getApiFormulaDependencies(apiFormula) ?? getReceiptDependencies(receipt);
  const stableVersion =
    receipt?.source?.versions?.stable ?? apiFormula?.stable_version;
  const revision = getFormulaRevision(activeVersion, stableVersion);
  const pinned = await isFormulaPinned(pinnedPath, name);
  const sha256 =
    cache?.bottleTag === platform ? apiFormula?.bottle_checksum : undefined;

  const formula: InstalledPackage = {
    name,
    version: activeVersion,
    type: "brew",
    installed: installedVersions,
    revision,
    tap: receipt?.source?.tap || undefined,
    pinned: pinned || undefined,
    dependencies,
    sha256,
    installed_on_request: receipt?.installed_on_request,
  };

  return { missingReceipt: receipt === null, package: formula };
}

async function readLinkedFormulaVersion(
  linkedPath: string,
  name: string,
  installedVersions: string[]
): Promise<string | null> {
  try {
    const target = await readlink(join(linkedPath, name));
    const linkedVersion = basename(target);
    return installedVersions.includes(linkedVersion) ? linkedVersion : null;
  } catch {
    return null;
  }
}

async function readInstallReceipt(
  path: string
): Promise<FormulaInstallReceipt | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as FormulaInstallReceipt;
  } catch {
    return null;
  }
}

async function isFormulaPinned(
  pinnedPath: string,
  name: string
): Promise<boolean> {
  try {
    return (await lstat(join(pinnedPath, name))).isSymbolicLink();
  } catch {
    return false;
  }
}

function getApiFormulaDependencies(
  apiFormula: FormulaApiMetadata | undefined
): string[] | undefined {
  const dependencies = apiFormula?.stable_dependencies
    ?.filter((dependency): dependency is string => typeof dependency === "string")
    .filter((dependency) => dependency.length > 0);

  return dependencies && dependencies.length > 0 ? dependencies : undefined;
}

function getReceiptDependencies(
  receipt: FormulaInstallReceipt | null
): string[] | undefined {
  const dependencies = receipt?.runtime_dependencies
    ?.filter((dependency) => dependency.declared_directly)
    .map((dependency) => dependency.full_name)
    .filter((dependency): dependency is string => Boolean(dependency));

  return dependencies && dependencies.length > 0 ? dependencies : undefined;
}

function getFormulaRevision(
  activeVersion: string,
  stableVersion: string | undefined
): number | undefined {
  if (!stableVersion) {
    return undefined;
  }

  const revisionPrefix = `${stableVersion}_`;
  if (!activeVersion.startsWith(revisionPrefix)) {
    return undefined;
  }

  const revision = Number.parseInt(
    activeVersion.slice(revisionPrefix.length),
    10
  );

  return Number.isFinite(revision) && revision > 0 ? revision : undefined;
}

async function readFormulaApiCache(
  platform: string
): Promise<FormulaApiCache | null> {
  return measurePerformance(
    "versionResolver.readFormulaApiCache",
    { platform },
    async (span) => {
      const cacheResult = await executeBrewCommand(["--cache"]);
      span.setAttribute("cacheExitCode", cacheResult.exitCode);

      if (!cacheResult.success) {
        span.setAttribute("found", false);
        return null;
      }

      const internalApiPath = join(
        cacheResult.stdout.trim(),
        "api",
        "internal"
      );
      span.setAttribute("internalApiPath", internalApiPath);

      let packageFiles: string[];
      try {
        packageFiles = (await readdir(internalApiPath))
          .filter((file) => /^packages\..+\.jws\.json$/.test(file))
          .sort((a, b) => a.localeCompare(b));
      } catch {
        span.setAttribute("found", false);
        return null;
      }

      const packageFile =
        packageFiles.find((file) => file === `packages.${platform}.jws.json`) ??
        packageFiles[0];

      if (!packageFile) {
        span.setAttribute("found", false);
        return null;
      }

      span.setAttribute("packageFile", packageFile);

      try {
        const outer = JSON.parse(
          await readFile(join(internalApiPath, packageFile), "utf8")
        ) as { payload?: string };
        const payload =
          typeof outer.payload === "string"
            ? (JSON.parse(outer.payload) as {
                metadata?: { bottle_tag?: string };
                formulae?: Record<string, FormulaApiMetadata>;
              })
            : null;
        const formulae = payload?.formulae ?? {};

        span.setAttributes({
          bottleTag: payload?.metadata?.bottle_tag,
          count: Object.keys(formulae).length,
          found: true,
        });

        return {
          bottleTag: payload?.metadata?.bottle_tag,
          formulae,
        };
      } catch {
        span.setAttribute("found", false);
        span.setAttribute("parseError", true);
        return null;
      }
    }
  );
}

/**
 * Get all installed casks with versions
 */
export async function getAllInstalledCasks(): Promise<InstalledPackage[]> {
  return measurePerformance(
    "versionResolver.getAllInstalledCasks",
    {},
    async (span) => {
      const backend = getCaskInfoBackend();
      span.setAttribute("backend", backend);

      if (backend === "local") {
        const localResult = await getAllInstalledCasksFromLocalState();
        span.setAttributes({
          localComplete: localResult.complete,
          localCount: localResult.packages.length,
        });

        if (localResult.complete) {
          span.setAttribute("count", localResult.packages.length);
          return localResult.packages;
        }

        span.setAttribute("fallbackBackend", "brew");
      }

      return getAllInstalledCasksFromBrewInfo(span);
    }
  );
}

function getCaskInfoBackend(): CaskInfoBackend {
  const backend = process.env.BREWLOCK_CASK_INFO_BACKEND?.trim().toLowerCase();

  return backend === "brew" ? "brew" : "local";
}

async function getAllInstalledCasksFromBrewInfo(span: {
  setAttribute(name: string, value: string | number | boolean): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
}): Promise<InstalledPackage[]> {
  const result = await executeBrewCommand([
    "info",
    "--cask",
    "--json=v2",
    "--installed",
  ]);
  span.setAttribute("brewExitCode", result.exitCode);

  if (!result.success) {
    span.setAttribute("count", 0);
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

    span.setAttribute("count", packages.length);
    return packages;
  } catch {
    span.setAttributes({
      count: 0,
      parseError: true,
    });
    return [];
  }
}

async function getAllInstalledCasksFromLocalState(): Promise<LocalCaskInfoResult> {
  return measurePerformance(
    "versionResolver.getAllInstalledCasksFromLocalState",
    {},
    async (span) => {
      const prefixResult = await executeBrewCommand(["--prefix"]);
      span.setAttribute("prefixExitCode", prefixResult.exitCode);

      if (!prefixResult.success) {
        span.setAttributes({
          complete: false,
          count: 0,
          fallbackReason: "prefixCommandFailed",
        });
        return { complete: false, packages: [] };
      }

      const prefix = prefixResult.stdout.trim();
      const caskroomPath = join(prefix, "Caskroom");
      span.setAttributes({ caskroomPath, prefix });

      let caskTokens: string[];
      try {
        caskTokens = (await readdir(caskroomPath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
      } catch {
        span.setAttributes({
          complete: false,
          count: 0,
          fallbackReason: "caskroomReadFailed",
        });
        return { complete: false, packages: [] };
      }

      const cache = await readCaskApiCache();
      span.setAttributes({
        caskApiCacheHit: cache !== null,
        caskApiCacheCount: cache?.casks.size ?? 0,
      });

      if (cache === null && caskTokens.length > 0) {
        span.setAttributes({
          complete: false,
          count: 0,
          fallbackReason: "caskApiCacheMissing",
        });
        return { complete: false, packages: [] };
      }

      const packages: InstalledPackage[] = [];
      let missingMetadataCount = 0;
      let missingReceiptCount = 0;

      const caskTaps = await readInstalledCaskTaps(caskroomPath, caskTokens);
      const officialCaskTokens = new Set(
        cache?.tokens.filter(
          (token) =>
            caskTokens.includes(token) &&
            (caskTaps.get(token) ?? cache.casks.get(token)?.tap) ===
              "homebrew/cask"
        ) ?? []
      );
      const orderedCaskTokens =
        cache === null
          ? caskTokens
          : [
              ...cache.tokens.filter((token) => officialCaskTokens.has(token)),
              ...caskTokens.filter((token) => !officialCaskTokens.has(token)),
            ];

      for (const token of orderedCaskTokens) {
        const cask = await readLocalCaskInfo({
          cache,
          caskroomPath,
          token,
        });

        if (cask.missingMetadata) {
          missingMetadataCount += 1;
        }
        if (cask.missingReceipt) {
          missingReceiptCount += 1;
        }
        if (cask.package) {
          packages.push(cask.package);
        }
      }

      const complete = missingMetadataCount === 0;
      span.setAttributes({
        complete,
        count: packages.length,
        caskTokenCount: caskTokens.length,
        missingMetadataCount,
        missingReceiptCount,
      });

      return { complete, packages: complete ? packages : [] };
    }
  );
}

async function readLocalCaskInfo({
  cache,
  caskroomPath,
  token,
}: {
  cache: CaskApiCache | null;
  caskroomPath: string;
  token: string;
}): Promise<{
  missingMetadata: boolean;
  missingReceipt: boolean;
  package?: InstalledPackage;
}> {
  const installedVersion = await readInstalledCaskVersion(caskroomPath, token);

  if (!installedVersion) {
    return { missingMetadata: true, missingReceipt: true };
  }

  const receipt = await readCaskInstallReceipt(
    join(caskroomPath, token, ".metadata", "INSTALL_RECEIPT.json")
  );
  const apiCask = cache?.casks.get(token);

  if (!apiCask) {
    return { missingMetadata: true, missingReceipt: receipt === null };
  }

  return {
    missingMetadata: false,
    missingReceipt: receipt === null,
    package: {
      name: token,
      version: installedVersion,
      type: "cask",
      tap: receipt?.source?.tap || apiCask.tap || undefined,
      sha256: apiCask.sha256 ?? undefined,
      auto_updates: apiCask.auto_updates ?? undefined,
    },
  };
}

async function readInstalledCaskTaps(
  caskroomPath: string,
  tokens: string[]
): Promise<Map<string, string>> {
  const taps = new Map<string, string>();

  await Promise.all(
    tokens.map(async (token) => {
      const receipt = await readCaskInstallReceipt(
        join(caskroomPath, token, ".metadata", "INSTALL_RECEIPT.json")
      );

      if (receipt?.source?.tap) {
        taps.set(token, receipt.source.tap);
      }
    })
  );

  return taps;
}

async function readInstalledCaskVersion(
  caskroomPath: string,
  token: string
): Promise<string | null> {
  try {
    const versionDirs = await Promise.all(
      (await readdir(join(caskroomPath, token), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name !== ".metadata")
        .map(async (entry) => ({
          name: entry.name,
          mtimeMs: (
            await stat(join(caskroomPath, token, entry.name))
          ).mtimeMs,
        }))
    );

    versionDirs.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    return versionDirs[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function readCaskInstallReceipt(
  path: string
): Promise<CaskInstallReceipt | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CaskInstallReceipt;
  } catch {
    return null;
  }
}

async function readCaskApiCache(): Promise<CaskApiCache | null> {
  return measurePerformance(
    "versionResolver.readCaskApiCache",
    {},
    async (span) => {
      const cacheResult = await executeBrewCommand(["--cache"]);
      span.setAttribute("cacheExitCode", cacheResult.exitCode);

      if (!cacheResult.success) {
        span.setAttribute("found", false);
        return null;
      }

      const caskApiPath = join(cacheResult.stdout.trim(), "api", "cask.jws.json");
      span.setAttribute("caskApiPath", caskApiPath);

      try {
        const outer = JSON.parse(await readFile(caskApiPath, "utf8")) as {
          payload?: string;
        };
        const payload =
          typeof outer.payload === "string"
            ? (JSON.parse(outer.payload) as CaskApiMetadata[])
            : [];
        const casks = new Map<string, CaskApiMetadata>();
        const tokens: string[] = [];

        for (const cask of payload) {
          if (cask.token) {
            casks.set(cask.token, cask);
            tokens.push(cask.token);
          }
        }

        span.setAttributes({
          count: casks.size,
          found: true,
        });

        return { casks, tokens };
      } catch {
        span.setAttribute("found", false);
        span.setAttribute("parseError", true);
        return null;
      }
    }
  );
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

type TapInfoBackend = "brew" | "git";

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  success: boolean;
}

interface GitTapInfoResult {
  complete: boolean;
  tap: TapInfo;
}

function getTapInfoBackend(): TapInfoBackend {
  const backend = process.env.BREWLOCK_TAP_INFO_BACKEND?.trim().toLowerCase();

  return backend === "brew" ? "brew" : "git";
}

/**
 * Get all taps (names only)
 */
export async function getAllTaps(): Promise<string[]> {
  return measurePerformance("versionResolver.getAllTaps", {}, async (span) => {
    const result = await executeBrewCommand(["tap"]);
    span.setAttribute("brewExitCode", result.exitCode);

    if (!result.success) {
      span.setAttribute("count", 0);
      return [];
    }

    const taps = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    span.setAttribute("count", taps.length);
    return taps;
  });
}

/**
 * Get all taps with detailed info (URL, commit, official)
 */
export async function getAllTapsWithInfo(): Promise<TapInfo[]> {
  return measurePerformance(
    "versionResolver.getAllTapsWithInfo",
    {},
    async (span) => {
      // First get the list of taps
      const tapNames = await getAllTaps();
      span.setAttribute("tapNameCount", tapNames.length);

      if (tapNames.length === 0) {
        span.setAttribute("count", 0);
        return [];
      }

      const backend = getTapInfoBackend();
      span.setAttribute("backend", backend);

      if (backend === "git") {
        const gitResult = await getAllTapsWithGitInfo(tapNames);
        span.setAttributes({
          directGitComplete: gitResult.complete,
          directGitCount: gitResult.taps.length,
        });

        if (gitResult.complete) {
          span.setAttribute("count", gitResult.taps.length);
          return gitResult.taps;
        }

        span.setAttribute("fallbackBackend", "brew");
      }

      return getAllTapsWithBrewInfo(tapNames, span);
    }
  );
}

async function getAllTapsWithBrewInfo(
  tapNames: string[],
  span: { setAttribute(name: string, value: string | number | boolean): void }
): Promise<TapInfo[]> {
  // Get detailed info for all taps
  const result = await executeBrewCommand(["tap-info", "--json", ...tapNames]);
  span.setAttribute("brewExitCode", result.exitCode);

  if (!result.success) {
    // Fall back to basic tap info without URL/commit
    const fallbackTaps = tapNames.map((name) => ({ name }));
    span.setAttribute("count", fallbackTaps.length);
    span.setAttribute("fallback", true);
    return fallbackTaps;
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

    span.setAttribute("count", taps.length);
    return taps;
  } catch {
    const fallbackTaps = tapNames.map((name) => ({ name }));
    span.setAttribute("count", fallbackTaps.length);
    span.setAttribute("fallback", true);
    span.setAttribute("parseError", true);
    return fallbackTaps;
  }
}

async function getAllTapsWithGitInfo(tapNames: string[]): Promise<{
  complete: boolean;
  taps: TapInfo[];
}> {
  return measurePerformance(
    "versionResolver.getAllTapsWithGitInfo",
    { tapCount: tapNames.length },
    async (span) => {
      const repoResult = await executeBrewCommand(["--repository"]);
      span.setAttribute("brewExitCode", repoResult.exitCode);

      if (!repoResult.success) {
        span.setAttribute("complete", false);
        span.setAttribute("count", 0);
        return { complete: false, taps: [] };
      }

      const brewRepo = repoResult.stdout.trim();
      span.setAttribute("brewRepo", brewRepo);

      const results = await Promise.all(
        tapNames.map((tapName) => getTapInfoFromGit(tapName, brewRepo))
      );
      const taps = results.map((result) => result.tap);
      const incompleteCount = results.filter(
        (result) => !result.complete
      ).length;
      const complete = incompleteCount === 0;

      span.setAttributes({
        complete,
        count: taps.length,
        incompleteCount,
      });

      return { complete, taps };
    }
  );
}

async function getTapInfoFromGit(
  tapName: string,
  brewRepo: string
): Promise<GitTapInfoResult> {
  return measurePerformance(
    "versionResolver.getTapInfoFromGit",
    { tapName },
    async (span) => {
      const official = tapName.startsWith("homebrew/");
      const tapPath = await resolveTapPath(tapName, brewRepo);
      span.setAttributes({
        official,
        pathFound: tapPath !== null,
      });

      const tap: TapInfo = {
        name: tapName,
        official: official || undefined,
      };

      if (tapPath === null) {
        return { complete: false, tap };
      }

      span.setAttribute("tapPath", tapPath);

      const [commitResult, remoteResult] = await Promise.all([
        executeGitCommand(tapPath, ["rev-parse", "HEAD"]),
        executeGitCommand(tapPath, ["remote", "get-url", "origin"]),
      ]);

      const commit = commitResult.stdout.trim();
      const remote = remoteResult.stdout.trim();

      if (commitResult.success && commit) {
        tap.commit = commit;
      }

      if (remoteResult.success && remote && !official) {
        tap.url = remote;
      }

      const complete = Boolean(tap.commit && (official || tap.url));
      span.setAttributes({
        commitFound: tap.commit !== undefined,
        complete,
        remoteFound: remoteResult.success && remote.length > 0,
      });

      return { complete, tap };
    }
  );
}

async function resolveTapPath(
  tapName: string,
  brewRepo: string
): Promise<string | null> {
  const [owner, repoName] = tapName.split("/");

  if (!owner || !repoName) {
    return null;
  }

  const candidates = [
    join(brewRepo, "Library", "Taps", owner, `homebrew-${repoName}`),
    join(brewRepo, "Library", "Taps", owner, repoName),
    join(brewRepo, "Library", "Taps", tapName),
  ];

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

async function executeGitCommand(
  cwd: string,
  args: string[]
): Promise<GitCommandResult> {
  return measurePerformance(
    "git.execute",
    {
      command: args.join(" "),
      cwd,
    },
    async (span) => {
      try {
        const proc = Bun.spawn(["git", "-C", cwd, ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        span.setAttributes({
          exitCode,
          stdoutBytes: stdout.length,
        });

        return {
          exitCode,
          stdout,
          success: exitCode === 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.setAttributes({
          error: message,
          exitCode: 1,
          stdoutBytes: 0,
        });

        return {
          exitCode: 1,
          stdout: "",
          success: false,
        };
      }
    }
  );
}

/**
 * Get the current commit SHA for a tap
 */
async function getTapCommit(tapName: string): Promise<string | null> {
  return measurePerformance(
    "versionResolver.getTapCommit",
    { tapName },
    async (span) => {
      try {
        // Tap directories are located at $(brew --repository)/Library/Taps/<user>/<repo>
        const repoResult = await executeBrewCommand(["--repository"]);
        span.setAttribute("brewExitCode", repoResult.exitCode);
        if (!repoResult.success) {
          return null;
        }

        const brewRepo = repoResult.stdout.trim();
        const tapPath = `${brewRepo}/Library/Taps/${tapName}`;
        span.setAttribute("tapPath", tapPath);

        // Get the current HEAD commit
        const proc = Bun.spawn(["git", "-C", tapPath, "rev-parse", "HEAD"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        span.setAttribute("gitExitCode", exitCode);

        if (exitCode !== 0) {
          return null;
        }

        const commit = stdout.trim() || null;
        span.setAttribute("found", commit !== null);
        return commit;
      } catch {
        span.setAttribute("error", true);
        return null;
      }
    }
  );
}

/**
 * Get installed mas apps with versions
 */
export async function getMasApps(): Promise<InstalledPackage[]> {
  return measurePerformance("versionResolver.getMasApps", {}, async (span) => {
    const masPath = Bun.which("mas");
    span.setAttribute("masInstalled", masPath !== null);

    if (masPath === null) {
      span.setAttribute("count", 0);
      return [];
    }

    span.setAttribute("masPath", masPath);

    try {
      // Use mas list to get installed apps
      const proc = Bun.spawn([masPath, "list"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      span.setAttribute("masExitCode", exitCode);

      if (exitCode !== 0) {
        span.setAttribute("count", 0);
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

      span.setAttribute("count", packages.length);
      return packages;
    } catch {
      span.setAttributes({
        count: 0,
        error: true,
      });
      return [];
    }
  });
}

/**
 * Get the version of a package by type and name
 */
export async function getPackageVersion(
  type: PackageType,
  name: string
): Promise<string | null> {
  return measurePerformance(
    "versionResolver.getPackageVersion",
    { name, type },
    async (span) => {
      switch (type) {
        case "brew": {
          const version = await getFormulaVersion(name);
          span.setAttribute("found", version !== null);
          span.setAttribute("version", version ?? undefined);
          return version;
        }
        case "cask": {
          const version = await getCaskVersion(name);
          span.setAttribute("found", version !== null);
          span.setAttribute("version", version ?? undefined);
          return version;
        }
        case "tap":
          // Taps don't have versions
          span.setAttribute("found", false);
          return null;
        case "mas": {
          // For mas, we need to search by name
          const apps = await getMasApps();
          const app = apps.find(
            (a) => a.name.toLowerCase() === name.toLowerCase()
          );
          span.setAttribute("found", app !== undefined);
          span.setAttribute("version", app?.version);
          return app?.version ?? null;
        }
        default:
          span.setAttribute("found", false);
          return null;
      }
    }
  );
}
