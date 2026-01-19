import { describe, expect, it } from "bun:test";

import { isModifyingCommand, parseCommand } from "../src/parser.ts";

describe("parseCommand", () => {
  describe("install commands", () => {
    it("parses single formula install", () => {
      const result = parseCommand(["install", "git"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["git"]);
      expect(result.isCask).toBe(false);
      expect(result.modifiesPackages).toBe(true);
      expect(result.isBundle).toBe(false);
    });

    it("parses multiple formulae install", () => {
      const result = parseCommand(["install", "git", "node", "python"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["git", "node", "python"]);
      expect(result.isCask).toBe(false);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses cask install with --cask flag", () => {
      const result = parseCommand(["install", "--cask", "visual-studio-code"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["visual-studio-code"]);
      expect(result.isCask).toBe(true);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses cask install with cask before package", () => {
      const result = parseCommand(["install", "--cask", "docker", "iterm2"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["docker", "iterm2"]);
      expect(result.isCask).toBe(true);
    });

    it("parses install with additional flags", () => {
      const result = parseCommand(["install", "--verbose", "git"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["git"]);
      expect(result.args).toContain("--verbose");
    });

    it("parses versioned formula install", () => {
      const result = parseCommand(["install", "python@3.11"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["python@3.11"]);
    });
  });

  describe("uninstall commands", () => {
    it("parses uninstall command", () => {
      const result = parseCommand(["uninstall", "git"]);
      expect(result.command).toBe("uninstall");
      expect(result.packages).toEqual(["git"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses remove alias", () => {
      const result = parseCommand(["remove", "git"]);
      expect(result.command).toBe("remove");
      expect(result.packages).toEqual(["git"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses rm alias", () => {
      const result = parseCommand(["rm", "git"]);
      expect(result.command).toBe("rm");
      expect(result.packages).toEqual(["git"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses cask uninstall", () => {
      const result = parseCommand(["uninstall", "--cask", "docker"]);
      expect(result.command).toBe("uninstall");
      expect(result.packages).toEqual(["docker"]);
      expect(result.isCask).toBe(true);
      expect(result.modifiesPackages).toBe(true);
    });
  });

  describe("upgrade commands", () => {
    it("parses upgrade all", () => {
      const result = parseCommand(["upgrade"]);
      expect(result.command).toBe("upgrade");
      expect(result.packages).toEqual([]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses upgrade specific formula", () => {
      const result = parseCommand(["upgrade", "git"]);
      expect(result.command).toBe("upgrade");
      expect(result.packages).toEqual(["git"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses upgrade multiple formulae", () => {
      const result = parseCommand(["upgrade", "git", "node"]);
      expect(result.command).toBe("upgrade");
      expect(result.packages).toEqual(["git", "node"]);
    });

    it("parses cask upgrade", () => {
      const result = parseCommand(["upgrade", "--cask", "docker"]);
      expect(result.command).toBe("upgrade");
      expect(result.packages).toEqual(["docker"]);
      expect(result.isCask).toBe(true);
    });
  });

  describe("tap commands", () => {
    it("parses tap command", () => {
      const result = parseCommand(["tap", "homebrew/cask"]);
      expect(result.command).toBe("tap");
      expect(result.packages).toEqual(["homebrew/cask"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses untap command", () => {
      const result = parseCommand(["untap", "homebrew/cask"]);
      expect(result.command).toBe("untap");
      expect(result.packages).toEqual(["homebrew/cask"]);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses tap list (no args)", () => {
      const result = parseCommand(["tap"]);
      expect(result.command).toBe("tap");
      expect(result.packages).toEqual([]);
      expect(result.modifiesPackages).toBe(false);
    });
  });

  describe("bundle commands", () => {
    it("parses bundle install", () => {
      const result = parseCommand(["bundle", "install"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("install");
      expect(result.isBundle).toBe(true);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses bundle dump", () => {
      const result = parseCommand(["bundle", "dump"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("dump");
      expect(result.isBundle).toBe(true);
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses bundle check", () => {
      const result = parseCommand(["bundle", "check"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("check");
      expect(result.isBundle).toBe(true);
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses bundle cleanup", () => {
      const result = parseCommand(["bundle", "cleanup"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("cleanup");
      expect(result.isBundle).toBe(true);
      expect(result.modifiesPackages).toBe(true);
    });

    it("parses bundle with file path", () => {
      const result = parseCommand(["bundle", "install", "--file=./Brewfile"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("install");
      expect(result.args).toContain("--file=./Brewfile");
    });

    it("parses bundle without subcommand (defaults to install)", () => {
      const result = parseCommand(["bundle"]);
      expect(result.command).toBe("bundle");
      expect(result.subcommand).toBe("install");
      expect(result.isBundle).toBe(true);
    });
  });

  describe("passthrough commands", () => {
    it("parses search command as passthrough", () => {
      const result = parseCommand(["search", "git"]);
      expect(result.command).toBe("search");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses info command as passthrough", () => {
      const result = parseCommand(["info", "git"]);
      expect(result.command).toBe("info");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses list command as passthrough", () => {
      const result = parseCommand(["list"]);
      expect(result.command).toBe("list");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses doctor command as passthrough", () => {
      const result = parseCommand(["doctor"]);
      expect(result.command).toBe("doctor");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses update command as passthrough", () => {
      const result = parseCommand(["update"]);
      expect(result.command).toBe("update");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses outdated command as passthrough", () => {
      const result = parseCommand(["outdated"]);
      expect(result.command).toBe("outdated");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses deps command as passthrough", () => {
      const result = parseCommand(["deps", "git"]);
      expect(result.command).toBe("deps");
      expect(result.modifiesPackages).toBe(false);
    });

    it("parses uses command as passthrough", () => {
      const result = parseCommand(["uses", "git"]);
      expect(result.command).toBe("uses");
      expect(result.modifiesPackages).toBe(false);
    });

    it("preserves all original args", () => {
      const result = parseCommand(["info", "--json=v2", "git"]);
      expect(result.args).toEqual(["info", "--json=v2", "git"]);
    });
  });

  describe("edge cases", () => {
    it("handles empty args", () => {
      const result = parseCommand([]);
      expect(result.command).toBe("");
      expect(result.packages).toEqual([]);
      expect(result.modifiesPackages).toBe(false);
    });

    it("handles flags before command", () => {
      const result = parseCommand(["--verbose", "install", "git"]);
      expect(result.command).toBe("install");
      expect(result.packages).toEqual(["git"]);
    });

    it("handles formula with tap prefix", () => {
      const result = parseCommand(["install", "homebrew/core/git"]);
      expect(result.packages).toEqual(["homebrew/core/git"]);
    });

    it("handles --formula flag", () => {
      const result = parseCommand(["install", "--formula", "git"]);
      expect(result.command).toBe("install");
      expect(result.isCask).toBe(false);
    });

    it("handles reinstall command", () => {
      const result = parseCommand(["reinstall", "git"]);
      expect(result.command).toBe("reinstall");
      expect(result.modifiesPackages).toBe(true);
    });
  });
});

describe("isModifyingCommand", () => {
  it("returns true for install", () => {
    expect(isModifyingCommand("install")).toBe(true);
  });

  it("returns true for uninstall", () => {
    expect(isModifyingCommand("uninstall")).toBe(true);
  });

  it("returns true for remove", () => {
    expect(isModifyingCommand("remove")).toBe(true);
  });

  it("returns true for rm", () => {
    expect(isModifyingCommand("rm")).toBe(true);
  });

  it("returns true for upgrade", () => {
    expect(isModifyingCommand("upgrade")).toBe(true);
  });

  it("returns true for tap", () => {
    expect(isModifyingCommand("tap")).toBe(true);
  });

  it("returns true for untap", () => {
    expect(isModifyingCommand("untap")).toBe(true);
  });

  it("returns true for reinstall", () => {
    expect(isModifyingCommand("reinstall")).toBe(true);
  });

  it("returns false for search", () => {
    expect(isModifyingCommand("search")).toBe(false);
  });

  it("returns false for info", () => {
    expect(isModifyingCommand("info")).toBe(false);
  });

  it("returns false for list", () => {
    expect(isModifyingCommand("list")).toBe(false);
  });

  it("returns false for doctor", () => {
    expect(isModifyingCommand("doctor")).toBe(false);
  });
});
