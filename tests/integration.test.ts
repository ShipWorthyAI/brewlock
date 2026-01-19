import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LockFile } from "../src/types.ts";
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

// Import modules after mocking
const { parseCommand } = await import("../src/parser.ts");
const { executeBrewCommand } = await import("../src/executor.ts");
const {
  parseLockFile,
  serializeLockFile,
  readLockFile,
  writeLockFile,
  upsertBrew,
  generateLockFile,
  checkLockFile,
} = await import("../src/lock-manager.ts");
const { getFormulaVersion } = await import("../src/version-resolver.ts");
const { bundleInstall } = await import("../src/bundle-install.ts");

const TEST_DIR = join(import.meta.dir, ".test-temp");
const TEST_LOCK_FILE = join(TEST_DIR, "brew.lock");

describe("End-to-end workflow", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    try {
      await unlink(TEST_LOCK_FILE);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("full roundtrip: generate, write, read, check", async () => {
    // Add mocks for all packages that will be checked
    addMockResponse(/info --json=v2 node$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "node",
            versions: { stable: "21.5.0", head: null },
            installed: [{ version: "21.5.0", installed_as_dependency: false }],
          },
        ],
      }),
      exitCode: 0,
    });
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

    // 1. Generate lock file from current system (mocked)
    const lockFile = await generateLockFile();
    expect(lockFile.version).toBe(1);

    // 2. Write to disk
    await writeLockFile(lockFile, TEST_LOCK_FILE);

    // 3. Read back
    const readBack = await readLockFile(TEST_LOCK_FILE);
    expect(Object.keys(readBack.brew).length).toBe(
      Object.keys(lockFile.brew).length
    );

    // 4. Check should match
    const checkResult = await checkLockFile(TEST_LOCK_FILE);
    expect(checkResult.matches).toBe(true);
  });

  it("parse command -> execute -> update lock file", async () => {
    // Simulate: brew install git
    const parsed = parseCommand(["install", "git"]);
    expect(parsed.command).toBe("install");
    expect(parsed.packages).toContain("git");
    expect(parsed.modifiesPackages).toBe(true);

    // After a successful install, we would:
    // 1. Get the installed version
    const version = await getFormulaVersion("git");
    expect(version).toBe("2.43.0");

    // 2. Update lock file
    let lockFile = await readLockFile(TEST_LOCK_FILE);

    if (version) {
      lockFile = upsertBrew(lockFile, "git", { version });
      await writeLockFile(lockFile, TEST_LOCK_FILE);

      // Verify
      const readBack = await readLockFile(TEST_LOCK_FILE);
      expect(readBack.brew.git?.version).toBe(version);
    }
  });

  it("bundle install from lock file", async () => {
    // Create a minimal lock file
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    // Run bundle install
    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });
    expect(success).toBe(true);
  });
});

describe("Command passthrough behavior", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("non-modifying commands pass through without lock file updates", async () => {
    const commands = [
      ["search", "git"],
      ["info", "git"],
      ["list"],
      ["doctor"],
      ["outdated"],
    ];

    for (const args of commands) {
      const parsed = parseCommand(args);
      expect(parsed.modifiesPackages).toBe(false);
    }
  });

  it("modifying commands trigger lock file updates", async () => {
    const commands = [
      ["install", "git"],
      ["uninstall", "git"],
      ["upgrade"],
      ["tap", "homebrew/cask"],
      ["bundle", "install"],
    ];

    for (const args of commands) {
      const parsed = parseCommand(args);
      expect(parsed.modifiesPackages).toBe(true);
    }
  });
});

describe("Lock file format compatibility", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    try {
      await unlink(TEST_LOCK_FILE);
    } catch {
      // Ignore
    }
  });

  it("generated lock file is valid JSON", async () => {
    const lockFile = await generateLockFile();
    const serialized = serializeLockFile(lockFile);

    // Should be valid JSON
    expect(() => JSON.parse(serialized)).not.toThrow();

    // Should have required fields
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("tap");
    expect(parsed).toHaveProperty("brew");
    expect(parsed).toHaveProperty("cask");
    expect(parsed).toHaveProperty("mas");
  });

  it("can parse JSONC format with comments", async () => {
    // JSONC with comments
    const content = `{
  // This is a comment
  "version": 1,
  "tap": {
    "homebrew/cask": {},
    "homebrew/bundle": {}
  },
  "brew": {
    "git": { "version": "2.43.0" },
    "node": { "version": "21.5.0" }
  },
  "cask": {
    "visual-studio-code": { "version": "1.85.1" }
  },
  "mas": {}
}`;
    const lockFile = parseLockFile(content);

    expect(Object.keys(lockFile.tap)).toHaveLength(2);
    expect(Object.keys(lockFile.brew)).toHaveLength(2);
    expect(Object.keys(lockFile.cask)).toHaveLength(1);
  });

  it("preserves version information in roundtrip", async () => {
    const original: LockFile = {
      version: 1,
      tap: { "homebrew/cask": { commit: "abc123" } },
      brew: {
        git: { version: "2.43.0" },
        "openssl@3": { version: "3.2.0_1" },
      },
      cask: { docker: { version: "4.26.1" } },
      mas: { Xcode: { id: 497799835, version: "15.2" } },
    };

    const serialized = serializeLockFile(original);
    const parsed = parseLockFile(serialized);

    expect(parsed).toEqual(original);
  });
});

describe("Error handling", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    setupCommonMocks();
  });

  afterEach(async () => {
    resetMocking();
    try {
      await unlink(TEST_LOCK_FILE);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("handles brew command failure gracefully", async () => {
    const result = await executeBrewCommand([
      "info",
      "nonexistent-formula-xyz-123",
    ]);

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("handles malformed lock file gracefully", async () => {
    const content = "this is not valid JSON at all";
    await writeFile(TEST_LOCK_FILE, content);

    // Should return empty lock file for malformed content
    const lockFile = await readLockFile(TEST_LOCK_FILE);
    expect(lockFile.version).toBe(1);
    expect(Object.keys(lockFile.tap)).toHaveLength(0);
    expect(Object.keys(lockFile.brew)).toHaveLength(0);
  });

  it("handles version mismatch in check", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "0.0.0-definitely-wrong" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await checkLockFile(TEST_LOCK_FILE);

    expect(result.matches).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });
});

describe("Cask handling", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("parses cask commands correctly", () => {
    const withFlag = parseCommand(["install", "--cask", "docker"]);
    expect(withFlag.isCask).toBe(true);
    expect(withFlag.packages).toEqual(["docker"]);

    const uninstall = parseCommand(["uninstall", "--cask", "docker"]);
    expect(uninstall.isCask).toBe(true);
    expect(uninstall.command).toBe("uninstall");
  });

  it("differentiates brew and cask in lock file", async () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { docker: { version: "24.0.0" } }, // docker CLI
      cask: { docker: { version: "4.26.1" } }, // Docker Desktop
      mas: {},
    };

    const serialized = serializeLockFile(lockFile);
    const parsed = parseLockFile(serialized);

    expect(parsed.brew.docker?.version).toBe("24.0.0");
    expect(parsed.cask.docker?.version).toBe("4.26.1");
  });
});

describe("Tap handling", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("parses tap commands correctly", () => {
    const tap = parseCommand(["tap", "homebrew/cask"]);
    expect(tap.command).toBe("tap");
    expect(tap.packages).toEqual(["homebrew/cask"]);
    expect(tap.modifiesPackages).toBe(true);

    const untap = parseCommand(["untap", "homebrew/cask"]);
    expect(untap.command).toBe("untap");
    expect(untap.modifiesPackages).toBe(true);

    const listTaps = parseCommand(["tap"]);
    expect(listTaps.command).toBe("tap");
    expect(listTaps.packages).toEqual([]);
    expect(listTaps.modifiesPackages).toBe(false);
  });

  it("taps can have commit in lock file", async () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": { commit: "abc123def456" } },
      brew: {},
      cask: {},
      mas: {},
    };

    const serialized = serializeLockFile(lockFile);
    const parsed = parseLockFile(serialized);

    expect(parsed.tap["homebrew/cask"]?.commit).toBe("abc123def456");
  });

  it("taps can have URL for custom repos", async () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {
        "shipworthyai/brewlock": {
          url: "https://github.com/ShipWorthyAI/brewlock.git",
          commit: "abc123",
        },
      },
      brew: {},
      cask: {},
      mas: {},
    };

    const serialized = serializeLockFile(lockFile);
    const parsed = parseLockFile(serialized);

    expect(parsed.tap["shipworthyai/brewlock"]?.url).toBe(
      "https://github.com/ShipWorthyAI/brewlock.git"
    );
    expect(parsed.tap["shipworthyai/brewlock"]?.commit).toBe("abc123");
  });
});

describe("Bundle command handling", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("parses various bundle subcommands", () => {
    const install = parseCommand(["bundle", "install"]);
    expect(install.isBundle).toBe(true);
    expect(install.subcommand).toBe("install");
    expect(install.modifiesPackages).toBe(true);

    const dump = parseCommand(["bundle", "dump"]);
    expect(dump.isBundle).toBe(true);
    expect(dump.subcommand).toBe("dump");
    expect(dump.modifiesPackages).toBe(false);

    const check = parseCommand(["bundle", "check"]);
    expect(check.isBundle).toBe(true);
    expect(check.subcommand).toBe("check");
    expect(check.modifiesPackages).toBe(false);

    const cleanup = parseCommand(["bundle", "cleanup"]);
    expect(cleanup.isBundle).toBe(true);
    expect(cleanup.subcommand).toBe("cleanup");
    expect(cleanup.modifiesPackages).toBe(true);
  });

  it("bare bundle command defaults to install", () => {
    const bundle = parseCommand(["bundle"]);
    expect(bundle.isBundle).toBe(true);
    expect(bundle.subcommand).toBe("install");
  });
});
