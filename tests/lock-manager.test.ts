import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseLockFile,
  readLockFile,
  removeEntry,
  serializeLockFile,
  upsertEntry,
  writeLockFile,
} from "../src/lock-manager.ts";
import type { LockEntry, LockFile } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".test-temp");
const TEST_LOCK_FILE = join(TEST_DIR, "brew.lock");

describe("parseLockFile", () => {
  it("parses empty file", () => {
    const result = parseLockFile("");
    expect(result.version).toBe(1);
    expect(result.entries).toEqual([]);
  });

  it("parses file with only header comment", () => {
    const result = parseLockFile("# brewlock v1\n");
    expect(result.version).toBe(1);
    expect(result.entries).toEqual([]);
  });

  it("parses single tap entry", () => {
    const content = `# brewlock v1
tap "homebrew/cask"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      type: "tap",
      name: "homebrew/cask",
    });
  });

  it("parses single brew entry with version", () => {
    const content = `# brewlock v1
brew "git", version: "2.43.0"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      type: "brew",
      name: "git",
      version: "2.43.0",
    });
  });

  it("parses brew entry without version", () => {
    const content = `# brewlock v1
brew "git"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      type: "brew",
      name: "git",
    });
  });

  it("parses cask entry with version", () => {
    const content = `# brewlock v1
cask "visual-studio-code", version: "1.85.1"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      type: "cask",
      name: "visual-studio-code",
      version: "1.85.1",
    });
  });

  it("parses mas entry with id and version", () => {
    const content = `# brewlock v1
mas "Xcode", id: 497799835, version: "15.2"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      type: "mas",
      name: "Xcode",
      id: 497799835,
      version: "15.2",
    });
  });

  it("parses full lock file with all types", () => {
    const content = `# brewlock v1
tap "homebrew/cask"
tap "homebrew/bundle"

brew "git", version: "2.43.0"
brew "node", version: "21.5.0"
brew "python@3.11", version: "3.11.7"

cask "visual-studio-code", version: "1.85.1"
cask "docker", version: "4.26.1"

mas "Xcode", id: 497799835, version: "15.2"
`;
    const result = parseLockFile(content);
    expect(result.version).toBe(1);
    expect(result.entries).toHaveLength(8);
    expect(result.entries[0]).toEqual({ type: "tap", name: "homebrew/cask" });
    expect(result.entries[2]).toEqual({
      type: "brew",
      name: "git",
      version: "2.43.0",
    });
    expect(result.entries[5]).toEqual({
      type: "cask",
      name: "visual-studio-code",
      version: "1.85.1",
    });
    expect(result.entries[7]).toEqual({
      type: "mas",
      name: "Xcode",
      id: 497799835,
      version: "15.2",
    });
  });

  it("handles complex version strings", () => {
    const content = `# brewlock v1
brew "openssl@3", version: "3.2.0_1"
brew "python@3.11", version: "3.11.7_1"
`;
    const result = parseLockFile(content);
    expect(result.entries[0]?.version).toBe("3.2.0_1");
    expect(result.entries[1]?.version).toBe("3.11.7_1");
  });

  it("ignores comment lines", () => {
    const content = `# brewlock v1
# This is a comment
tap "homebrew/cask"
# Another comment
brew "git", version: "2.43.0"
`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(2);
  });

  it("ignores blank lines", () => {
    const content = `# brewlock v1

tap "homebrew/cask"


brew "git", version: "2.43.0"

`;
    const result = parseLockFile(content);
    expect(result.entries).toHaveLength(2);
  });

  it("handles malformed lines gracefully", () => {
    const content = `# brewlock v1
tap "homebrew/cask"
this is not valid
brew "git", version: "2.43.0"
`;
    const result = parseLockFile(content);
    // Should still parse valid entries
    expect(result.entries).toHaveLength(2);
  });
});

describe("serializeLockFile", () => {
  it("serializes empty lock file", () => {
    const lockFile: LockFile = { version: 1, entries: [] };
    const result = serializeLockFile(lockFile);
    expect(result).toBe("# brewlock v1\n");
  });

  it("serializes tap entry", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "tap", name: "homebrew/cask" }],
    };
    const result = serializeLockFile(lockFile);
    expect(result).toContain('tap "homebrew/cask"');
  });

  it("serializes brew entry with version", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };
    const result = serializeLockFile(lockFile);
    expect(result).toContain('brew "git", version: "2.43.0"');
  });

  it("serializes cask entry with version", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "cask", name: "docker", version: "4.26.1" }],
    };
    const result = serializeLockFile(lockFile);
    expect(result).toContain('cask "docker", version: "4.26.1"');
  });

  it("serializes mas entry with id and version", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "mas", name: "Xcode", id: 497799835, version: "15.2" }],
    };
    const result = serializeLockFile(lockFile);
    expect(result).toContain('mas "Xcode", id: 497799835, version: "15.2"');
  });

  it("groups entries by type with blank lines", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [
        { type: "tap", name: "homebrew/cask" },
        { type: "tap", name: "homebrew/bundle" },
        { type: "brew", name: "git", version: "2.43.0" },
        { type: "cask", name: "docker", version: "4.26.1" },
      ],
    };
    const result = serializeLockFile(lockFile);
    const _lines = result.split("\n");

    // Should have blank lines between different types
    expect(result).toMatch(/tap.*\n\ntap.*|tap.*\n\nbrew/);
  });

  it("roundtrip: parse then serialize preserves data", () => {
    const original = `# brewlock v1
tap "homebrew/cask"

brew "git", version: "2.43.0"

cask "docker", version: "4.26.1"

mas "Xcode", id: 497799835, version: "15.2"
`;
    const parsed = parseLockFile(original);
    const serialized = serializeLockFile(parsed);
    const reparsed = parseLockFile(serialized);

    expect(reparsed.version).toBe(parsed.version);
    expect(reparsed.entries).toEqual(parsed.entries);
  });
});

describe("readLockFile", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(TEST_LOCK_FILE);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("reads and parses existing lock file", async () => {
    const content = `# brewlock v1
brew "git", version: "2.43.0"
`;
    await writeFile(TEST_LOCK_FILE, content);

    const result = await readLockFile(TEST_LOCK_FILE);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.name).toBe("git");
  });

  it("returns empty lock file when file doesn't exist", async () => {
    const result = await readLockFile(join(TEST_DIR, "nonexistent.lock"));
    expect(result.version).toBe(1);
    expect(result.entries).toEqual([]);
  });
});

describe("writeLockFile", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(TEST_LOCK_FILE);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("writes lock file to disk", async () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };

    await writeLockFile(lockFile, TEST_LOCK_FILE);

    const content = await Bun.file(TEST_LOCK_FILE).text();
    expect(content).toContain("# brewlock v1");
    expect(content).toContain('brew "git", version: "2.43.0"');
  });

  it("overwrites existing lock file", async () => {
    await writeFile(TEST_LOCK_FILE, "old content");

    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "node", version: "21.0.0" }],
    };

    await writeLockFile(lockFile, TEST_LOCK_FILE);

    const content = await Bun.file(TEST_LOCK_FILE).text();
    expect(content).not.toContain("old content");
    expect(content).toContain('brew "node"');
  });
});

describe("upsertEntry", () => {
  it("adds new entry to empty lock file", () => {
    const lockFile: LockFile = { version: 1, entries: [] };
    const entry: LockEntry = { type: "brew", name: "git", version: "2.43.0" };

    const result = upsertEntry(lockFile, entry);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual(entry);
  });

  it("adds new entry to existing lock file", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };
    const entry: LockEntry = { type: "brew", name: "node", version: "21.0.0" };

    const result = upsertEntry(lockFile, entry);

    expect(result.entries).toHaveLength(2);
  });

  it("updates existing entry version", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };
    const entry: LockEntry = { type: "brew", name: "git", version: "2.44.0" };

    const result = upsertEntry(lockFile, entry);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.version).toBe("2.44.0");
  });

  it("does not modify original lock file", () => {
    const lockFile: LockFile = { version: 1, entries: [] };
    const entry: LockEntry = { type: "brew", name: "git", version: "2.43.0" };

    upsertEntry(lockFile, entry);

    expect(lockFile.entries).toHaveLength(0);
  });

  it("differentiates between brew and cask with same name", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "docker", version: "1.0.0" }],
    };
    const entry: LockEntry = {
      type: "cask",
      name: "docker",
      version: "4.26.1",
    };

    const result = upsertEntry(lockFile, entry);

    expect(result.entries).toHaveLength(2);
  });

  it("maintains entry order by type", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [
        { type: "tap", name: "homebrew/cask" },
        { type: "brew", name: "git", version: "2.43.0" },
      ],
    };
    const entry: LockEntry = { type: "tap", name: "homebrew/bundle" };

    const result = upsertEntry(lockFile, entry);

    // Taps should be grouped together
    const tapIndices = result.entries
      .map((e, i) => (e.type === "tap" ? i : -1))
      .filter((i) => i >= 0);
    expect(tapIndices).toEqual([0, 1]);
  });
});

describe("removeEntry", () => {
  it("removes existing entry", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [
        { type: "brew", name: "git", version: "2.43.0" },
        { type: "brew", name: "node", version: "21.0.0" },
      ],
    };

    const result = removeEntry(lockFile, "brew", "git");

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.name).toBe("node");
  });

  it("returns unchanged lock file when entry not found", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };

    const result = removeEntry(lockFile, "brew", "nonexistent");

    expect(result.entries).toHaveLength(1);
  });

  it("does not modify original lock file", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [{ type: "brew", name: "git", version: "2.43.0" }],
    };

    removeEntry(lockFile, "brew", "git");

    expect(lockFile.entries).toHaveLength(1);
  });

  it("only removes matching type", () => {
    const lockFile: LockFile = {
      version: 1,
      entries: [
        { type: "brew", name: "docker", version: "1.0.0" },
        { type: "cask", name: "docker", version: "4.26.1" },
      ],
    };

    const result = removeEntry(lockFile, "brew", "docker");

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.type).toBe("cask");
  });
});
