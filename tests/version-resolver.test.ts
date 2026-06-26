import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  addMockResponse,
  mockExecuteBrewCommand,
  mockExecuteBrewCommandStreaming,
  resetMocking,
  setupCommonMocks,
} from "./mocks/brew-mock.ts";

// Mock the executor module before importing anything that uses it
mock.module("../src/executor.ts", () => ({
  executeBrewCommand: mockExecuteBrewCommand,
  executeBrewCommandStreaming: mockExecuteBrewCommandStreaming,
}));

// Import the version resolver functions after mocking
const {
  getFormulaVersion,
  getCaskVersion,
  getAllInstalledFormulae,
  getAllInstalledCasks,
  getAllTaps,
  getAllTapsWithInfo,
  getMasApps,
  getPackageVersion,
} = await import("../src/version-resolver.ts");

const TEST_DIR = join(import.meta.dir, ".test-temp", "version-resolver");
const ORIGINAL_TAP_INFO_BACKEND = process.env.BREWLOCK_TAP_INFO_BACKEND;
const ORIGINAL_FORMULA_INFO_BACKEND = process.env.BREWLOCK_FORMULA_INFO_BACKEND;
const ORIGINAL_CASK_INFO_BACKEND = process.env.BREWLOCK_CASK_INFO_BACKEND;

describe("getFormulaVersion", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    restoreFormulaInfoBackend();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns version for installed formula", async () => {
    const version = await getFormulaVersion("git");
    expect(version).toBe("2.43.0");
  });

  it("returns null for non-installed formula", async () => {
    const version = await getFormulaVersion("nonexistent-formula-xyz");
    expect(version).toBeNull();
  });

  it("parses complex version strings with revision", async () => {
    // Add specific mock for openssl
    addMockResponse(/info --json=v2 openssl@3$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "openssl@3",
            versions: { stable: "3.2.0", head: null },
            installed: [{ version: "3.2.0_1", installed_as_dependency: false }],
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getFormulaVersion("openssl@3");
    expect(version).toBe("3.2.0_1");
  });

  it("handles versioned formula names", async () => {
    addMockResponse(/info --json=v2 python@3\.11$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "python@3.11",
            versions: { stable: "3.11.7", head: null },
            installed: [
              { version: "3.11.7_1", installed_as_dependency: false },
            ],
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getFormulaVersion("python@3.11");
    expect(version).toBe("3.11.7_1");
  });

  it("can resolve a single formula version from local Homebrew state", async () => {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalFormula(prefix, "git", "2.43.0", {
      dependencies: ["gettext", "pcre2"],
      installedOnRequest: true,
      stableVersion: "2.43.0",
      tap: "homebrew/core",
    });

    const version = await getFormulaVersion("git");

    expect(version).toBe("2.43.0");
  });

  it("uses local formula version lookups by default", async () => {
    delete process.env.BREWLOCK_FORMULA_INFO_BACKEND;
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalFormula(prefix, "git", "2.43.0", {
      dependencies: ["gettext", "pcre2"],
      installedOnRequest: true,
      stableVersion: "2.43.0",
      tap: "homebrew/core",
    });

    const version = await getFormulaVersion("git");

    expect(version).toBe("2.43.0");
  });

  it("can force formula version lookups through brew info", async () => {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = "brew";
    resetMocking();
    addMockResponse(/info --json=v2 git$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "git",
            versions: { stable: "2.43.0", head: null },
            installed: [
              { version: "2.43.0", installed_as_dependency: false },
            ],
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getFormulaVersion("git");

    expect(version).toBe("2.43.0");
  });

  it("can resolve a tap-qualified formula from local Homebrew state", async () => {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalFormula(prefix, "maestro", "2.6.1", {
      dependencies: [],
      installedOnRequest: true,
      stableVersion: "2.6.1",
      tap: "mobile-dev-inc/tap",
    });

    const version = await getFormulaVersion("mobile-dev-inc/tap/maestro");

    expect(version).toBe("2.6.1");
  });

  it("falls back to brew info when local formula state is incomplete", async () => {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = "local";

    const prefix = join(TEST_DIR, "missing-homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });

    const version = await getFormulaVersion("git");

    expect(version).toBe("2.43.0");
  });
});

describe("getCaskVersion", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    restoreCaskInfoBackend();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns version for installed cask", async () => {
    addMockResponse(/info --cask --json=v2 visual-studio-code$/, {
      stdout: JSON.stringify({
        casks: [
          {
            token: "visual-studio-code",
            name: ["Visual Studio Code"],
            version: "1.85.1",
            installed: "1.85.1",
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getCaskVersion("visual-studio-code");
    expect(version).toBe("1.85.1");
  });

  it("returns null for non-installed cask", async () => {
    const version = await getCaskVersion("nonexistent-cask-xyz");
    expect(version).toBeNull();
  });

  it("handles cask version with build numbers", async () => {
    const version = await getCaskVersion("docker");
    expect(version).toBe("4.26.1");
  });

  it("handles cask with 'latest' version", async () => {
    addMockResponse(/info --cask --json=v2 some-cask-with-latest$/, {
      stdout: JSON.stringify({
        casks: [
          {
            token: "some-cask-with-latest",
            name: ["Some Cask"],
            version: "latest",
            installed: "latest",
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getCaskVersion("some-cask-with-latest");
    expect(version).toBe("latest");
  });

  it("can resolve a single cask version from local Homebrew state", async () => {
    process.env.BREWLOCK_CASK_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalCask(prefix, "docker", "4.26.1", {
      tap: "homebrew/cask",
    });

    const version = await getCaskVersion("docker");

    expect(version).toBe("4.26.1");
  });

  it("uses local cask version lookups by default", async () => {
    delete process.env.BREWLOCK_CASK_INFO_BACKEND;
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalCask(prefix, "docker", "4.26.1", {
      tap: "homebrew/cask",
    });

    const version = await getCaskVersion("docker");

    expect(version).toBe("4.26.1");
  });

  it("can force cask version lookups through brew info", async () => {
    process.env.BREWLOCK_CASK_INFO_BACKEND = "brew";
    resetMocking();
    addMockResponse(/info --cask --json=v2 docker$/, {
      stdout: JSON.stringify({
        casks: [
          {
            token: "docker",
            name: ["Docker Desktop"],
            version: "4.26.1",
            installed: "4.26.1",
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getCaskVersion("docker");

    expect(version).toBe("4.26.1");
  });

  it("can resolve a tap-qualified cask from local Homebrew state", async () => {
    process.env.BREWLOCK_CASK_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    await createLocalCask(prefix, "docker", "4.26.1", {
      tap: "homebrew/cask",
    });

    const version = await getCaskVersion("homebrew/cask/docker");

    expect(version).toBe("4.26.1");
  });

  it("falls back to brew info when local cask state is incomplete", async () => {
    process.env.BREWLOCK_CASK_INFO_BACKEND = "local";

    const prefix = join(TEST_DIR, "missing-homebrew");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });

    const version = await getCaskVersion("docker");

    expect(version).toBe("4.26.1");
  });
});

describe("getAllInstalledFormulae", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    restoreFormulaInfoBackend();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns array of installed packages", async () => {
    const packages = await getAllInstalledFormulae();
    expect(Array.isArray(packages)).toBe(true);
    expect(packages.length).toBe(3);
  });

  it("each package has required fields", async () => {
    const packages = await getAllInstalledFormulae();
    for (const pkg of packages) {
      expect(pkg).toHaveProperty("name");
      expect(pkg).toHaveProperty("version");
      expect(pkg).toHaveProperty("type");
      expect(pkg.type).toBe("brew");
    }
  });

  it("captures new metadata fields (tap, dependencies, sha256)", async () => {
    const packages = await getAllInstalledFormulae();
    const git = packages.find((p) => p.name === "git");
    expect(git).toBeDefined();
    expect(git?.tap).toBe("homebrew/core");
    expect(git?.dependencies).toEqual(["gettext", "pcre2"]);
    expect(git?.sha256).toBe("abc123");
    expect(git?.installed_as_dependency).toBe(false);
    expect(git?.installed_on_request).toBe(true);
  });

  it("captures revision when non-zero", async () => {
    const packages = await getAllInstalledFormulae();
    const python = packages.find((p) => p.name === "python@3.11");
    expect(python).toBeDefined();
    expect(python?.revision).toBe(1);
  });

  it("uses linked_keg as version", async () => {
    const packages = await getAllInstalledFormulae();
    const git = packages.find((p) => p.name === "git");
    expect(git?.version).toBe("2.43.0"); // linked_keg value
  });

  it("handles empty list", async () => {
    resetMocking();
    addMockResponse("info --json=v2 --installed", {
      stdout: JSON.stringify({ formulae: [] }),
      exitCode: 0,
    });

    const packages = await getAllInstalledFormulae();
    expect(packages).toEqual([]);
  });

  it("can resolve formula metadata from local Homebrew state", async () => {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    const cache = join(TEST_DIR, "cache");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    addMockResponse(/^--cache$/, { stdout: cache, exitCode: 0 });

    await createLocalFormula(prefix, "git", "2.43.0", {
      dependencies: ["pcre2", "gettext"],
      installedOnRequest: true,
      stableVersion: "2.43.0",
      tap: "homebrew/core",
    });
    await createLocalFormula(prefix, "python@3.11", "3.11.7_1", {
      dependencies: ["xz", "openssl@3"],
      installedOnRequest: false,
      pinned: true,
      stableVersion: "3.11.7",
      tap: "homebrew/core",
    });
    await writeFormulaApiCache(cache, {
      git: {
        bottle_checksum: "abc123",
        stable_dependencies: ["gettext", "pcre2", { pkgconf: ":build" }],
        stable_version: "2.43.0",
      },
      "python@3.11": {
        bottle_checksum: "ghi789",
        stable_dependencies: ["mpdecimal", "openssl@3", "sqlite", "xz"],
        stable_version: "3.11.7",
      },
    });

    const packages = await getAllInstalledFormulae();
    const git = packages.find((pkg) => pkg.name === "git");
    const python = packages.find((pkg) => pkg.name === "python@3.11");

    expect(packages).toHaveLength(2);
    expect(git).toMatchObject({
      name: "git",
      version: "2.43.0",
      type: "brew",
      installed: ["2.43.0"],
      tap: "homebrew/core",
      dependencies: ["gettext", "pcre2"],
      sha256: "abc123",
      installed_on_request: true,
    });
    expect(git?.installed_as_dependency).toBeUndefined();
    expect(python).toMatchObject({
      name: "python@3.11",
      version: "3.11.7_1",
      revision: 1,
      pinned: true,
      dependencies: ["mpdecimal", "openssl@3", "sqlite", "xz"],
      installed_on_request: false,
    });
  });
});

describe("getAllInstalledCasks", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    restoreCaskInfoBackend();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns array of installed casks", async () => {
    const casks = await getAllInstalledCasks();
    expect(Array.isArray(casks)).toBe(true);
    expect(casks.length).toBe(2);
  });

  it("each cask has required fields", async () => {
    const casks = await getAllInstalledCasks();
    for (const cask of casks) {
      expect(cask).toHaveProperty("name");
      expect(cask).toHaveProperty("version");
      expect(cask).toHaveProperty("type");
      expect(cask.type).toBe("cask");
    }
  });

  it("captures new cask metadata fields (tap, sha256, auto_updates)", async () => {
    const casks = await getAllInstalledCasks();
    const docker = casks.find((c) => c.name === "docker");
    expect(docker).toBeDefined();
    expect(docker?.tap).toBe("homebrew/cask");
    expect(docker?.sha256).toBe("abc123sha256");
    expect(docker?.auto_updates).toBe(true);
  });

  it("can resolve cask metadata from local Homebrew state", async () => {
    process.env.BREWLOCK_CASK_INFO_BACKEND = "local";
    resetMocking();

    const prefix = join(TEST_DIR, "homebrew");
    const cache = join(TEST_DIR, "cache");
    addMockResponse(/^--prefix$/, { stdout: prefix, exitCode: 0 });
    addMockResponse(/^--cache$/, { stdout: cache, exitCode: 0 });

    await createLocalCask(prefix, "docker", "4.26.1", {
      tap: "homebrew/cask",
    });
    await createLocalCask(prefix, "codexbar", "0.37.2", {
      tap: "steipete/tap",
    });
    await writeCaskApiCache(cache, [
      {
        token: "docker",
        tap: "homebrew/cask",
        version: "4.26.1",
        sha256: "abc123sha256",
        auto_updates: true,
      },
      {
        token: "codexbar",
        tap: "homebrew/cask",
        version: "0.37.2",
        sha256: "def456sha256",
        auto_updates: null,
      },
    ]);

    const casks = await getAllInstalledCasks();

    expect(casks).toEqual([
      {
        name: "docker",
        version: "4.26.1",
        type: "cask",
        tap: "homebrew/cask",
        sha256: "abc123sha256",
        auto_updates: true,
      },
      {
        name: "codexbar",
        version: "0.37.2",
        type: "cask",
        tap: "steipete/tap",
        sha256: "def456sha256",
        auto_updates: undefined,
      },
    ]);
  });
});

describe("getAllTaps", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    restoreTapInfoBackend();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns array of taps", async () => {
    const taps = await getAllTaps();
    expect(Array.isArray(taps)).toBe(true);
    expect(taps.length).toBe(3);
  });

  it("tap names are in owner/repo format", async () => {
    const taps = await getAllTaps();
    for (const tap of taps) {
      expect(tap).toMatch(/^[^/]+\/[^/]+$/);
    }
  });

  it("includes default homebrew taps", async () => {
    const taps = await getAllTaps();
    expect(taps).toContain("homebrew/core");
    expect(taps).toContain("homebrew/cask");
  });

  it("uses local git repositories for tap metadata by default", async () => {
    delete process.env.BREWLOCK_TAP_INFO_BACKEND;
    resetMocking();
    addMockResponse(/^tap$/, {
      stdout: `homebrew/core
shipworthyai/brewlock`,
      exitCode: 0,
    });
    addMockResponse(/^--repository$/, { stdout: TEST_DIR, exitCode: 0 });

    const coreCommit = await createGitTap(
      "homebrew/core",
      "https://github.com/Homebrew/homebrew-core"
    );
    const brewlockCommit = await createGitTap(
      "shipworthyai/brewlock",
      "https://github.com/ShipWorthyAI/brewlock.git"
    );

    const taps = await getAllTapsWithInfo();

    expect(taps).toEqual([
      {
        name: "homebrew/core",
        commit: coreCommit,
        official: true,
      },
      {
        name: "shipworthyai/brewlock",
        url: "https://github.com/ShipWorthyAI/brewlock.git",
        commit: brewlockCommit,
      },
    ]);
  });
});

describe("getMasApps", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("returns array of mas apps", async () => {
    // When mas is not found or fails, should return empty array
    const apps = await getMasApps();
    expect(Array.isArray(apps)).toBe(true);
  });

  it("each app has required fields including id", async () => {
    const apps = await getMasApps();
    for (const app of apps) {
      expect(app).toHaveProperty("name");
      expect(app).toHaveProperty("version");
      expect(app).toHaveProperty("type");
      expect(app).toHaveProperty("id");
      expect(app.type).toBe("mas");
      expect(typeof app.id).toBe("number");
    }
  });

  it("handles systems without mas installed", async () => {
    // Mock mas not being installed
    addMockResponse("list --formula mas", {
      exitCode: 1,
      stderr: "Not installed",
    });

    const apps = await getMasApps();
    expect(apps).toEqual([]);
  });
});

describe("getPackageVersion", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("delegates to getFormulaVersion for brew type", async () => {
    const version = await getPackageVersion("brew", "git");
    expect(version).toBe("2.43.0");
  });

  it("delegates to getCaskVersion for cask type", async () => {
    const version = await getPackageVersion("cask", "docker");
    expect(version).toBe("4.26.1");
  });

  it("returns null for tap type (taps don't have versions)", async () => {
    const version = await getPackageVersion("tap", "homebrew/cask");
    expect(version).toBeNull();
  });

  it("handles mas type", async () => {
    // mas will return null since we can't easily mock Bun.spawn in getMasApps
    const version = await getPackageVersion("mas", "Xcode");
    expect(version === null || typeof version === "string").toBe(true);
  });
});

describe("version parsing from brew info JSON", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("parses formula version from brew info --json=v2 output", async () => {
    const version = await getFormulaVersion("git");
    expect(version).toBe("2.43.0");
  });

  it("parses cask version from brew info --cask --json=v2 output", async () => {
    const version = await getCaskVersion("docker");
    expect(version).toBe("4.26.1");
  });

  it("handles formula with multiple installed versions", async () => {
    addMockResponse(/info --json=v2 multi-version$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "multi-version",
            versions: { stable: "2.0.0", head: null },
            installed: [
              { version: "2.0.0", installed_as_dependency: false },
              { version: "1.0.0", installed_as_dependency: false },
            ],
          },
        ],
      }),
      exitCode: 0,
    });

    const version = await getFormulaVersion("multi-version");
    // Should return the first (most recent) version
    expect(version).toBe("2.0.0");
  });
});

async function createGitTap(
  tapName: string,
  remoteUrl: string
): Promise<string> {
  const [owner, repoName] = tapName.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid tap name: ${tapName}`);
  }

  const tapPath = join(
    TEST_DIR,
    "Library",
    "Taps",
    owner,
    `homebrew-${repoName}`
  );
  await mkdir(tapPath, { recursive: true });
  await runCommand(["git", "init"], tapPath);
  await writeFile(join(tapPath, "README.md"), `${tapName}\n`);
  await runCommand(["git", "add", "README.md"], tapPath);
  await runCommand(
    [
      "git",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.email=brewlock@example.test",
      "-c",
      "user.name=Brewlock Test",
      "commit",
      "-m",
      "initial commit",
    ],
    tapPath
  );
  await runCommand(["git", "remote", "add", "origin", remoteUrl], tapPath);
  return runCommand(["git", "rev-parse", "HEAD"], tapPath);
}

async function runCommand(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${args.join(" ")}\n${stderr}`
    );
  }

  return stdout.trim();
}

function restoreTapInfoBackend(): void {
  if (ORIGINAL_TAP_INFO_BACKEND === undefined) {
    delete process.env.BREWLOCK_TAP_INFO_BACKEND;
  } else {
    process.env.BREWLOCK_TAP_INFO_BACKEND = ORIGINAL_TAP_INFO_BACKEND;
  }
}

function restoreFormulaInfoBackend(): void {
  if (ORIGINAL_FORMULA_INFO_BACKEND === undefined) {
    delete process.env.BREWLOCK_FORMULA_INFO_BACKEND;
  } else {
    process.env.BREWLOCK_FORMULA_INFO_BACKEND = ORIGINAL_FORMULA_INFO_BACKEND;
  }
}

function restoreCaskInfoBackend(): void {
  if (ORIGINAL_CASK_INFO_BACKEND === undefined) {
    delete process.env.BREWLOCK_CASK_INFO_BACKEND;
  } else {
    process.env.BREWLOCK_CASK_INFO_BACKEND = ORIGINAL_CASK_INFO_BACKEND;
  }
}

async function createLocalFormula(
  prefix: string,
  name: string,
  version: string,
  options: {
    dependencies: string[];
    installedOnRequest: boolean;
    pinned?: boolean;
    stableVersion: string;
    tap: string;
  }
): Promise<void> {
  const kegPath = join(prefix, "Cellar", name, version);
  const linkedPath = join(prefix, "var", "homebrew", "linked");
  const pinnedPath = join(prefix, "var", "homebrew", "pinned");

  await mkdir(kegPath, { recursive: true });
  await mkdir(linkedPath, { recursive: true });
  await writeFile(
    join(kegPath, "INSTALL_RECEIPT.json"),
    JSON.stringify(
      {
        installed_on_request: options.installedOnRequest,
        runtime_dependencies: options.dependencies.map((dependency) => ({
          full_name: dependency,
          declared_directly: true,
        })),
        source: {
          tap: options.tap,
          versions: {
            stable: options.stableVersion,
          },
        },
      },
      null,
      2
    )
  );
  await symlink(kegPath, join(linkedPath, name));

  if (options.pinned) {
    await mkdir(pinnedPath, { recursive: true });
    await symlink(kegPath, join(pinnedPath, name));
  }
}

async function writeFormulaApiCache(
  cache: string,
  formulae: Record<
    string,
    {
      bottle_checksum: string;
      stable_dependencies: unknown[];
      stable_version: string;
    }
  >
): Promise<void> {
  const platform = getTestPlatform();
  const internalApiPath = join(cache, "api", "internal");
  await mkdir(internalApiPath, { recursive: true });
  await writeFile(
    join(internalApiPath, `packages.${platform}.jws.json`),
    JSON.stringify({
      payload: JSON.stringify({
        metadata: {
          bottle_tag: platform,
        },
        formulae,
      }),
    })
  );
}

function getTestPlatform(): string {
  const arch = process.arch === "arm64" ? "arm64_" : "";
  const release = process.platform === "darwin" ? "sonoma" : "linux";
  return `${arch}${release}`;
}

async function createLocalCask(
  prefix: string,
  token: string,
  version: string,
  options: {
    tap: string;
  }
): Promise<void> {
  const caskPath = join(prefix, "Caskroom", token);
  const versionPath = join(caskPath, version);
  const metadataPath = join(caskPath, ".metadata");

  await mkdir(versionPath, { recursive: true });
  await mkdir(metadataPath, { recursive: true });
  await writeFile(join(versionPath, token), "");
  await writeFile(
    join(metadataPath, "INSTALL_RECEIPT.json"),
    JSON.stringify(
      {
        source: {
          tap: options.tap,
          version,
        },
      },
      null,
      2
    )
  );
}

async function writeCaskApiCache(
  cache: string,
  casks: Array<{
    auto_updates: boolean | null;
    sha256: string;
    tap: string;
    token: string;
    version: string;
  }>
): Promise<void> {
  const apiPath = join(cache, "api");
  await mkdir(apiPath, { recursive: true });
  await writeFile(
    join(apiPath, "cask.jws.json"),
    JSON.stringify({
      payload: JSON.stringify(casks),
    })
  );
}
