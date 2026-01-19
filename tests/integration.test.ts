import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LockEntry, LockFile } from "../src/types.ts";
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
  upsertEntry,
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
    expect(readBack.entries.length).toBe(lockFile.entries.length);

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
      const entry: LockEntry = {
        type: "brew",
        name: "git",
        version,
      };
      lockFile = upsertEntry(lockFile, entry);
      await writeLockFile(lockFile, TEST_LOCK_FILE);

      // Verify
      const readBack = await readLockFile(TEST_LOCK_FILE);
      const gitEntry = readBack.entries.find(
        (e) => e.type === "brew" && e.name === "git"
      );
      expect(gitEntry?.version).toBe(version);
    }
  });

  it("bundle install from lock file", async () => {
    // Create a minimal lock file
    const content = `# brewlock v1
`;
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

  it("generated lock file is valid Brewfile syntax", async () => {
    const lockFile = await generateLockFile();
    const serialized = serializeLockFile(lockFile);

    // Should start with header comment
    expect(serialized.startsWith("# brewlock v1")).toBe(true);

    // Each non-comment, non-empty line should be valid syntax
    const lines = serialized.split("\n");
    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        // Should match: type "name"[, key: value]*
        expect(line).toMatch(/^(tap|brew|cask|mas)\s+"[^"]+"/);
      }
    }
  });

  it("can parse standard Brewfile format", async () => {
    // Standard Brewfile without versions (for compatibility)
    const content = `
tap "homebrew/cask"
tap "homebrew/bundle"

brew "git"
brew "node"

cask "visual-studio-code"
`;
    const lockFile = parseLockFile(content);

    expect(lockFile.entries.length).toBe(5);
    expect(lockFile.entries.filter((e) => e.type === "tap").length).toBe(2);
    expect(lockFile.entries.filter((e) => e.type === "brew").length).toBe(2);
    expect(lockFile.entries.filter((e) => e.type === "cask").length).toBe(1);
  });

  it("preserves version information in roundtrip", async () => {
    const original: LockFile = {
      version: 1,
      entries: [
        { type: "tap", name: "homebrew/cask" },
        { type: "brew", name: "git", version: "2.43.0" },
        { type: "brew", name: "openssl@3", version: "3.2.0_1" },
        { type: "cask", name: "docker", version: "4.26.1" },
        { type: "mas", name: "Xcode", id: 497799835, version: "15.2" },
      ],
    };

    const serialized = serializeLockFile(original);
    const parsed = parseLockFile(serialized);

    expect(parsed.entries.length).toBe(original.entries.length);

    for (let i = 0; i < original.entries.length; i++) {
      expect(parsed.entries[i]?.type).toBe(original.entries[i]?.type);
      expect(parsed.entries[i]?.name).toBe(original.entries[i]?.name);
      expect(parsed.entries[i]?.version).toBe(original.entries[i]?.version);
      expect(parsed.entries[i]?.id).toBe(original.entries[i]?.id);
    }
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
    const content = `
this is not valid
neither is this
tap "homebrew/cask"
more invalid stuff
brew "git", version: "2.43.0"
`;
    await writeFile(TEST_LOCK_FILE, content);

    // Should still parse valid entries
    const lockFile = await readLockFile(TEST_LOCK_FILE);
    expect(lockFile.entries.length).toBe(2);
  });

  it("handles version mismatch in check", async () => {
    const content = `# brewlock v1
brew "git", version: "0.0.0-definitely-wrong"
`;
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
      entries: [
        { type: "brew", name: "docker", version: "24.0.0" }, // docker CLI
        { type: "cask", name: "docker", version: "4.26.1" }, // Docker Desktop
      ],
    };

    const serialized = serializeLockFile(lockFile);
    expect(serialized).toContain('brew "docker"');
    expect(serialized).toContain('cask "docker"');

    const parsed = parseLockFile(serialized);
    expect(parsed.entries.filter((e) => e.name === "docker").length).toBe(2);
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

  it("taps have no version in lock file", async () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "tap", name: "homebrew/cask" }],
    };

    const serialized = serializeLockFile(lockFile);
    expect(serialized).toContain('tap "homebrew/cask"');
    expect(serialized).not.toContain("version");
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
