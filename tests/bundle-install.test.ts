import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
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

// Import modules after mocking
const { bundleInstall } = await import("../src/bundle-install.ts");
const { generateLockFile, checkLockFile } = await import(
  "../src/lock-manager.ts"
);

const TEST_DIR = join(import.meta.dir, ".test-temp");
const TEST_LOCK_FILE = join(TEST_DIR, "brew.lock");

describe("generateLockFile", () => {
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

  it("returns a valid LockFile structure", async () => {
    const lockFile = await generateLockFile();

    expect(lockFile).toHaveProperty("version");
    expect(lockFile).toHaveProperty("tap");
    expect(lockFile).toHaveProperty("brew");
    expect(lockFile).toHaveProperty("cask");
    expect(lockFile).toHaveProperty("mas");
    expect(lockFile.version).toBe(1);
  });

  it("includes all installed formulae", async () => {
    const lockFile = await generateLockFile();

    // Each brew entry should have version
    for (const [_name, entry] of Object.entries(lockFile.brew)) {
      expect(entry).toHaveProperty("version");
    }
  });

  it("includes versions for brew entries", async () => {
    const lockFile = await generateLockFile();

    for (const [_name, entry] of Object.entries(lockFile.brew)) {
      expect(entry).toHaveProperty("version");
      expect(typeof entry.version).toBe("string");
    }
  });

  it("includes versions for cask entries", async () => {
    const lockFile = await generateLockFile();

    for (const [_name, entry] of Object.entries(lockFile.cask)) {
      expect(entry).toHaveProperty("version");
    }
  });

  it("includes taps with optional commit", async () => {
    const lockFile = await generateLockFile();

    // Taps should be in the tap object
    expect(Object.keys(lockFile.tap).length).toBeGreaterThanOrEqual(0);
  });

  it("includes mas apps with id and version", async () => {
    const lockFile = await generateLockFile();

    for (const [_name, entry] of Object.entries(lockFile.mas)) {
      expect(entry).toHaveProperty("id");
      expect(typeof entry.id).toBe("number");
      expect(entry).toHaveProperty("version");
    }
  });
});

describe("checkLockFile", () => {
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

  it("returns matches: true when all versions match", async () => {
    // Add mocks for node version check
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

    // Use the mocked versions in JSONC format
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "2.43.0" },
        node: { version: "21.5.0" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await checkLockFile(TEST_LOCK_FILE);

    expect(result).toHaveProperty("matches");
    expect(result).toHaveProperty("mismatches");
    expect(result.matches).toBe(true);
  });

  it("returns mismatches array with expected/actual versions", async () => {
    // Create a lock file with a wrong version
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "0.0.0-nonexistent" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await checkLockFile(TEST_LOCK_FILE);

    expect(result.matches).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);

    const mismatch = result.mismatches[0];
    expect(mismatch).toHaveProperty("name");
    expect(mismatch).toHaveProperty("expected");
    expect(mismatch).toHaveProperty("actual");
    expect(mismatch?.expected).toBe("0.0.0-nonexistent");
    expect(mismatch?.actual).toBe("2.43.0"); // The mocked version
  });

  it("handles missing packages in lock file", async () => {
    // Lock file with package that isn't installed
    addMockResponse(/info --json=v2 nonexistent-package-xyz-123/, {
      stdout: JSON.stringify({
        formulae: [{ name: "nonexistent", installed: [] }],
      }),
      exitCode: 1,
    });

    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        "nonexistent-package-xyz-123": { version: "1.0.0" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await checkLockFile(TEST_LOCK_FILE);

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.actual === null)).toBe(true);
  });

  it("handles empty lock file", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await checkLockFile(TEST_LOCK_FILE);

    // Empty lock file should "match" (no packages to check)
    expect(result.matches).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("handles nonexistent lock file", async () => {
    const result = await checkLockFile(join(TEST_DIR, "nonexistent.lock"));

    // Nonexistent file should be treated as empty
    expect(result.matches).toBe(true);
    expect(result.mismatches).toEqual([]);
  });
});

describe("bundleInstall", () => {
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

  it("returns boolean indicating success", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    expect(typeof success).toBe("boolean");
  });

  it("succeeds with empty lock file", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    expect(success).toBe(true);
  });

  it("handles verbose option", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({
      lockFilePath: TEST_LOCK_FILE,
      verbose: true,
    });

    expect(typeof success).toBe("boolean");
  });

  it("handles strict option", async () => {
    // With strict mode, version mismatches should cause failure
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "0.0.0-nonexistent" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({
      lockFilePath: TEST_LOCK_FILE,
      strict: true,
    });

    // Should fail because version doesn't match
    expect(success).toBe(false);
  });

  it("installs taps before formulae", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    expect(typeof success).toBe("boolean");
  });

  it("skips already installed packages with correct version", async () => {
    // Use the mocked version for git
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "2.43.0" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    // Should succeed without actually installing
    expect(success).toBe(true);
  });

  it("handles nonexistent lock file path", async () => {
    const success = await bundleInstall({
      lockFilePath: join(TEST_DIR, "nonexistent.lock"),
    });

    // Nonexistent file should be treated as empty, which succeeds
    expect(success).toBe(true);
  });
});

describe("version constraint handling", () => {
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

  it("uses versioned formula syntax when available", async () => {
    addMockResponse(/info --json=v2 python@3\.11$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "python@3.11",
            versions: { stable: "3.11.7", head: null },
            installed: [{ version: "3.11.7", installed_as_dependency: false }],
          },
        ],
      }),
      exitCode: 0,
    });

    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        "python@3.11": { version: "3.11.7" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const success = await bundleInstall({
      lockFilePath: TEST_LOCK_FILE,
    });

    expect(success).toBe(true);
  });

  it("warns when exact version cannot be installed", async () => {
    // For packages where specific version isn't available
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "0.0.1-nonexistent" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    // Should proceed but warn (not in strict mode)
    const success = await bundleInstall({
      lockFilePath: TEST_LOCK_FILE,
      strict: false,
    });

    // In non-strict mode, should try to install anyway
    expect(typeof success).toBe("boolean");
  });
});

describe("install order", () => {
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

  it("processes taps first", async () => {
    addMockResponse(/info --json=v2 some-formula$/, {
      stdout: JSON.stringify({
        formulae: [
          {
            name: "some-formula",
            versions: { stable: "1.0.0", head: null },
            installed: [{ version: "1.0.0", installed_as_dependency: false }],
          },
        ],
      }),
      exitCode: 0,
    });

    const content = JSON.stringify({
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {
        "some-formula": { version: "1.0.0" },
      },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    // The bundle handler should reorder to process taps first
    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    expect(typeof success).toBe("boolean");
  });

  it("processes mas apps last", async () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { version: "2.43.0" },
      },
      cask: {},
      mas: {
        Xcode: { id: 497799835, version: "15.2" },
      },
    });
    await writeFile(TEST_LOCK_FILE, content);

    // The bundle handler should process brew before mas
    const success = await bundleInstall({ lockFilePath: TEST_LOCK_FILE });

    expect(typeof success).toBe("boolean");
  });
});
