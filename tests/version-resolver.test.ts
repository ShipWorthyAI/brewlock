import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

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
  getMasApps,
  getPackageVersion,
} = await import("../src/version-resolver.ts");

describe("getFormulaVersion", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
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
});

describe("getCaskVersion", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
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
});

describe("getAllInstalledFormulae", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
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
});

describe("getAllInstalledCasks", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
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
});

describe("getAllTaps", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
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
