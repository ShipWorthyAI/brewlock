import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createEmptyLockFile,
  parseLockFile,
  readLockFile,
  removeBrew,
  removeCask,
  removeEntry,
  removeTap,
  serializeLockFile,
  upsertBrew,
  upsertCask,
  upsertMas,
  upsertTap,
  writeLockFile,
} from "../src/lock-manager.ts";
import type { LockFile } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".test-temp");
const TEST_LOCK_FILE = join(TEST_DIR, "brew.lock");

describe("parseLockFile", () => {
  it("parses empty file", () => {
    const result = parseLockFile("");
    expect(result.version).toBe(1);
    expect(result.tap).toEqual({});
    expect(result.brew).toEqual({});
    expect(result.cask).toEqual({});
    expect(result.mas).toEqual({});
  });

  it("parses minimal JSONC file", () => {
    const content = `{ "version": 1, "tap": {}, "brew": {}, "cask": {}, "mas": {} }`;
    const result = parseLockFile(content);
    expect(result.version).toBe(1);
  });

  it("parses JSONC with comments", () => {
    const content = `{
  // This is a comment
  "version": 1,
  "tap": {},
  "brew": {},
  "cask": {},
  "mas": {}
}`;
    const result = parseLockFile(content);
    expect(result.version).toBe(1);
  });

  it("parses single tap entry", () => {
    const content = JSON.stringify({
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(Object.keys(result.tap)).toHaveLength(1);
    expect(result.tap["homebrew/cask"]).toEqual({});
  });

  it("parses tap with URL and commit", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {
        "shipworthyai/brewlock": {
          url: "https://github.com/ShipWorthyAI/brewlock.git",
          commit: "abc123def",
        },
      },
      brew: {},
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.tap["shipworthyai/brewlock"]).toEqual({
      url: "https://github.com/ShipWorthyAI/brewlock.git",
      commit: "abc123def",
    });
  });

  it("parses brew entry with version", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.brew.git).toEqual({ version: "2.43.0" });
  });

  it("parses brew entry with metadata", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: {
          version: "2.43.0",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      },
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.brew.git).toEqual({
      version: "2.43.0",
      installed_as_dependency: false,
      installed_on_request: true,
    });
  });

  it("parses cask entry with version", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: { "visual-studio-code": { version: "1.85.1" } },
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.cask["visual-studio-code"]).toEqual({ version: "1.85.1" });
  });

  it("parses mas entry with id and version", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: { Xcode: { id: 497799835, version: "15.2" } },
    });
    const result = parseLockFile(content);
    expect(result.mas.Xcode).toEqual({ id: 497799835, version: "15.2" });
  });

  it("parses full lock file with all types", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {
        "homebrew/cask": {},
        "homebrew/bundle": { commit: "abc123" },
      },
      brew: {
        git: { version: "2.43.0" },
        node: { version: "21.5.0" },
        "python@3.11": { version: "3.11.7" },
      },
      cask: {
        "visual-studio-code": { version: "1.85.1" },
        docker: { version: "4.26.1" },
      },
      mas: {
        Xcode: { id: 497799835, version: "15.2" },
      },
    });
    const result = parseLockFile(content);
    expect(result.version).toBe(1);
    expect(Object.keys(result.tap)).toHaveLength(2);
    expect(Object.keys(result.brew)).toHaveLength(3);
    expect(Object.keys(result.cask)).toHaveLength(2);
    expect(Object.keys(result.mas)).toHaveLength(1);
  });

  it("handles complex version strings", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        "openssl@3": { version: "3.2.0_1" },
        "python@3.11": { version: "3.11.7_1" },
      },
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.brew["openssl@3"]?.version).toBe("3.2.0_1");
    expect(result.brew["python@3.11"]?.version).toBe("3.11.7_1");
  });

  it("handles malformed JSON gracefully", () => {
    const content = "this is not valid JSON";
    const result = parseLockFile(content);
    expect(result.version).toBe(1);
    expect(result.tap).toEqual({});
    expect(result.brew).toEqual({});
    expect(result.cask).toEqual({});
    expect(result.mas).toEqual({});
  });

  it("handles partial JSON gracefully", () => {
    const content = `{ "version": 2, "tap": { "homebrew/cask": {} } }`;
    const result = parseLockFile(content);
    expect(result.version).toBe(2);
    expect(result.tap).toEqual({ "homebrew/cask": {} });
    expect(result.brew).toEqual({});
    expect(result.cask).toEqual({});
    expect(result.mas).toEqual({});
  });

  it("parses brew entry with all new metadata fields", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: {
          version: "2.52.0",
          installed: ["2.52.0", "2.51.0"],
          revision: 1,
          tap: "homebrew/core",
          pinned: false,
          dependencies: ["gettext", "pcre2"],
          sha256: "abc123def456",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      },
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.brew.git).toEqual({
      version: "2.52.0",
      installed: ["2.52.0", "2.51.0"],
      revision: 1,
      tap: "homebrew/core",
      pinned: false,
      dependencies: ["gettext", "pcre2"],
      sha256: "abc123def456",
      installed_as_dependency: false,
      installed_on_request: true,
    });
  });

  it("parses cask entry with all new metadata fields", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {
        "docker-desktop": {
          version: "4.56.0,214940",
          tap: "homebrew/cask",
          sha256: "0a55468sha256",
          auto_updates: true,
        },
      },
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.cask["docker-desktop"]).toEqual({
      version: "4.56.0,214940",
      tap: "homebrew/cask",
      sha256: "0a55468sha256",
      auto_updates: true,
    });
  });

  it("parses tap entry with official field", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {
        "homebrew/core": {
          commit: "abc123",
          official: true,
        },
        "shipworthyai/brewlock": {
          url: "https://github.com/ShipWorthyAI/brewlock.git",
          commit: "def456",
        },
      },
      brew: {},
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    expect(result.tap["homebrew/core"]).toEqual({
      commit: "abc123",
      official: true,
    });
    expect(result.tap["shipworthyai/brewlock"]).toEqual({
      url: "https://github.com/ShipWorthyAI/brewlock.git",
      commit: "def456",
    });
  });

  it("rejects invalid brew entry (missing version)", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {
        git: { installed_on_request: true }, // missing version
      },
      cask: {},
      mas: {},
    });
    const result = parseLockFile(content);
    // Should return empty lock file on validation failure
    expect(result.brew).toEqual({});
  });

  it("rejects invalid mas entry (missing id)", () => {
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: {
        Xcode: { version: "15.2" }, // missing id
      },
    });
    const result = parseLockFile(content);
    // Should return empty lock file on validation failure
    expect(result.mas).toEqual({});
  });
});

describe("serializeLockFile", () => {
  it("serializes empty lock file", () => {
    const lockFile = createEmptyLockFile();
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe(1);
    expect(parsed.tap).toEqual({});
    expect(parsed.brew).toEqual({});
    expect(parsed.cask).toEqual({});
    expect(parsed.mas).toEqual({});
  });

  it("serializes tap entry", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    };
    const result = serializeLockFile(lockFile);
    expect(result).toContain('"homebrew/cask"');
  });

  it("serializes tap with URL and commit", () => {
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
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.tap["shipworthyai/brewlock"].url).toBe(
      "https://github.com/ShipWorthyAI/brewlock.git"
    );
    expect(parsed.tap["shipworthyai/brewlock"].commit).toBe("abc123");
  });

  it("serializes brew entry with version", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.brew.git.version).toBe("2.43.0");
  });

  it("serializes brew entry with metadata", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {
        git: {
          version: "2.43.0",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      },
      cask: {},
      mas: {},
    };
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.brew.git.installed_as_dependency).toBe(false);
    expect(parsed.brew.git.installed_on_request).toBe(true);
  });

  it("serializes cask entry with version", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: { docker: { version: "4.26.1" } },
      mas: {},
    };
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.cask.docker.version).toBe("4.26.1");
  });

  it("serializes mas entry with id and version", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: { Xcode: { id: 497799835, version: "15.2" } },
    };
    const result = serializeLockFile(lockFile);
    const parsed = JSON.parse(result);
    expect(parsed.mas.Xcode.id).toBe(497799835);
    expect(parsed.mas.Xcode.version).toBe("15.2");
  });

  it("roundtrip: parse then serialize preserves data", () => {
    const original: LockFile = {
      version: 1,
      tap: { "homebrew/cask": { commit: "abc123" } },
      brew: { git: { version: "2.43.0" } },
      cask: { docker: { version: "4.26.1" } },
      mas: { Xcode: { id: 497799835, version: "15.2" } },
    };
    const serialized = serializeLockFile(original);
    const reparsed = parseLockFile(serialized);

    expect(reparsed).toEqual(original);
  });

  it("produces valid JSON with trailing newline", () => {
    const lockFile = createEmptyLockFile();
    const result = serializeLockFile(lockFile);
    expect(result.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(result)).not.toThrow();
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
    const content = JSON.stringify({
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    });
    await writeFile(TEST_LOCK_FILE, content);

    const result = await readLockFile(TEST_LOCK_FILE);
    expect(result.brew.git?.version).toBe("2.43.0");
  });

  it("returns empty lock file when file doesn't exist", async () => {
    const result = await readLockFile(join(TEST_DIR, "nonexistent.lock"));
    expect(result.version).toBe(1);
    expect(result.tap).toEqual({});
    expect(result.brew).toEqual({});
    expect(result.cask).toEqual({});
    expect(result.mas).toEqual({});
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
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };

    await writeLockFile(lockFile, TEST_LOCK_FILE);

    const content = await Bun.file(TEST_LOCK_FILE).text();
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.brew.git.version).toBe("2.43.0");
  });

  it("overwrites existing lock file", async () => {
    await writeFile(TEST_LOCK_FILE, "old content");

    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { node: { version: "21.0.0" } },
      cask: {},
      mas: {},
    };

    await writeLockFile(lockFile, TEST_LOCK_FILE);

    const content = await Bun.file(TEST_LOCK_FILE).text();
    expect(content).not.toContain("old content");
    expect(content).toContain("node");
  });
});

describe("upsertTap", () => {
  it("adds new tap to empty lock file", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertTap(lockFile, "homebrew/cask", {});

    expect(result.tap["homebrew/cask"]).toEqual({});
  });

  it("adds tap with URL and commit", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertTap(lockFile, "shipworthyai/brewlock", {
      url: "https://github.com/ShipWorthyAI/brewlock.git",
      commit: "abc123",
    });

    expect(result.tap["shipworthyai/brewlock"]).toEqual({
      url: "https://github.com/ShipWorthyAI/brewlock.git",
      commit: "abc123",
    });
  });

  it("updates existing tap", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    };

    const result = upsertTap(lockFile, "homebrew/cask", { commit: "newcommit" });

    expect(result.tap["homebrew/cask"]).toEqual({ commit: "newcommit" });
  });

  it("does not modify original lock file", () => {
    const lockFile = createEmptyLockFile();

    upsertTap(lockFile, "homebrew/cask", {});

    expect(lockFile.tap["homebrew/cask"]).toBeUndefined();
  });
});

describe("upsertBrew", () => {
  it("adds new brew entry to empty lock file", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertBrew(lockFile, "git", { version: "2.43.0" });

    expect(result.brew.git).toEqual({ version: "2.43.0" });
  });

  it("adds brew entry with metadata", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertBrew(lockFile, "git", {
      version: "2.43.0",
      installed_as_dependency: false,
      installed_on_request: true,
    });

    expect(result.brew.git).toEqual({
      version: "2.43.0",
      installed_as_dependency: false,
      installed_on_request: true,
    });
  });

  it("updates existing brew entry version", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };

    const result = upsertBrew(lockFile, "git", { version: "2.44.0" });

    expect(result.brew.git?.version).toBe("2.44.0");
  });

  it("does not modify original lock file", () => {
    const lockFile = createEmptyLockFile();

    upsertBrew(lockFile, "git", { version: "2.43.0" });

    expect(lockFile.brew.git).toBeUndefined();
  });
});

describe("upsertCask", () => {
  it("adds new cask entry to empty lock file", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertCask(lockFile, "docker", { version: "4.26.1" });

    expect(result.cask.docker).toEqual({ version: "4.26.1" });
  });

  it("updates existing cask entry", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: { docker: { version: "4.26.0" } },
      mas: {},
    };

    const result = upsertCask(lockFile, "docker", { version: "4.26.1" });

    expect(result.cask.docker?.version).toBe("4.26.1");
  });
});

describe("upsertMas", () => {
  it("adds new mas entry to empty lock file", () => {
    const lockFile = createEmptyLockFile();

    const result = upsertMas(lockFile, "Xcode", { id: 497799835, version: "15.2" });

    expect(result.mas.Xcode).toEqual({ id: 497799835, version: "15.2" });
  });

  it("updates existing mas entry", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: { Xcode: { id: 497799835, version: "15.1" } },
    };

    const result = upsertMas(lockFile, "Xcode", { id: 497799835, version: "15.2" });

    expect(result.mas.Xcode?.version).toBe("15.2");
  });
});

describe("removeTap", () => {
  it("removes existing tap", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {}, "homebrew/bundle": {} },
      brew: {},
      cask: {},
      mas: {},
    };

    const result = removeTap(lockFile, "homebrew/cask");

    expect(result.tap["homebrew/cask"]).toBeUndefined();
    expect(result.tap["homebrew/bundle"]).toEqual({});
  });

  it("returns unchanged lock file when tap not found", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    };

    const result = removeTap(lockFile, "nonexistent/tap");

    expect(Object.keys(result.tap)).toHaveLength(1);
  });

  it("does not modify original lock file", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    };

    removeTap(lockFile, "homebrew/cask");

    expect(lockFile.tap["homebrew/cask"]).toEqual({});
  });
});

describe("removeBrew", () => {
  it("removes existing brew entry", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {
        git: { version: "2.43.0" },
        node: { version: "21.0.0" },
      },
      cask: {},
      mas: {},
    };

    const result = removeBrew(lockFile, "git");

    expect(result.brew.git).toBeUndefined();
    expect(result.brew.node).toEqual({ version: "21.0.0" });
  });

  it("returns unchanged lock file when entry not found", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };

    const result = removeBrew(lockFile, "nonexistent");

    expect(Object.keys(result.brew)).toHaveLength(1);
  });

  it("does not modify original lock file", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };

    removeBrew(lockFile, "git");

    expect(lockFile.brew.git).toEqual({ version: "2.43.0" });
  });
});

describe("removeCask", () => {
  it("removes existing cask entry", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: {
        docker: { version: "4.26.1" },
        firefox: { version: "120.0" },
      },
      mas: {},
    };

    const result = removeCask(lockFile, "docker");

    expect(result.cask.docker).toBeUndefined();
    expect(result.cask.firefox).toEqual({ version: "120.0" });
  });
});

describe("removeEntry", () => {
  it("removes tap by type", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: { "homebrew/cask": {} },
      brew: {},
      cask: {},
      mas: {},
    };

    const result = removeEntry(lockFile, "tap", "homebrew/cask");

    expect(result.tap["homebrew/cask"]).toBeUndefined();
  });

  it("removes brew by type", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { git: { version: "2.43.0" } },
      cask: {},
      mas: {},
    };

    const result = removeEntry(lockFile, "brew", "git");

    expect(result.brew.git).toBeUndefined();
  });

  it("removes cask by type", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: { docker: { version: "4.26.1" } },
      mas: {},
    };

    const result = removeEntry(lockFile, "cask", "docker");

    expect(result.cask.docker).toBeUndefined();
  });

  it("removes mas by type", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: {},
      cask: {},
      mas: { Xcode: { id: 497799835, version: "15.2" } },
    };

    const result = removeEntry(lockFile, "mas", "Xcode");

    expect(result.mas.Xcode).toBeUndefined();
  });

  it("differentiates between brew and cask with same name", () => {
    const lockFile: LockFile = {
      version: 1,
      tap: {},
      brew: { docker: { version: "1.0.0" } },
      cask: { docker: { version: "4.26.1" } },
      mas: {},
    };

    const result = removeEntry(lockFile, "brew", "docker");

    expect(result.brew.docker).toBeUndefined();
    expect(result.cask.docker).toEqual({ version: "4.26.1" });
  });
});
