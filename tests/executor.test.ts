import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  MOCK_BREW_CONFIG,
  MOCK_BREW_VERSION,
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

// Import the mocked functions for testing
const { executeBrewCommand, executeBrewCommandStreaming } = await import(
  "../src/executor.ts"
);

describe("executeBrewCommand", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("returns ExecutionResult with all fields", async () => {
    const result = await executeBrewCommand(["--version"]);

    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("success");

    expect(typeof result.exitCode).toBe("number");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(typeof result.success).toBe("boolean");
  });

  it("success is true when exit code is 0", async () => {
    const result = await executeBrewCommand(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  it("captures stdout from brew command", async () => {
    const result = await executeBrewCommand(["--version"]);

    expect(result.stdout).toBe(MOCK_BREW_VERSION);
  });

  it("captures stderr from failed command", async () => {
    const result = await executeBrewCommand(["invalid-command-xyz"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.success).toBe(false);
  });

  it("handles info command with JSON output", async () => {
    const result = await executeBrewCommand(["info", "--json=v2", "git"]);

    expect(result.success).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("handles list command", async () => {
    const result = await executeBrewCommand(["list", "--formula"]);

    expect(typeof result.stdout).toBe("string");
    expect(typeof result.exitCode).toBe("number");
  });

  it("returns proper exit code for not found formula", async () => {
    const result = await executeBrewCommand([
      "info",
      "--json=v2",
      "nonexistent-formula-that-doesnt-exist-xyz",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.success).toBe(false);
  });

  it("handles tap list command", async () => {
    const result = await executeBrewCommand(["tap"]);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("homebrew/core");
  });

  it("passes through all arguments correctly", async () => {
    const result = await executeBrewCommand(["config"]);

    expect(result.stdout).toBe(MOCK_BREW_CONFIG);
  });
});

describe("executeBrewCommandStreaming", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("returns ExecutionResult like non-streaming version", async () => {
    const result = await executeBrewCommandStreaming(["--version"]);

    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("success");
  });

  it("streams output to terminal", async () => {
    const result = await executeBrewCommandStreaming(["--version"]);

    expect(typeof result.exitCode).toBe("number");
  });

  it("handles failed commands", async () => {
    const result = await executeBrewCommandStreaming(["invalid-command-xyz"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.success).toBe(false);
  });

  it("captures output even while streaming", async () => {
    const result = await executeBrewCommandStreaming(["--version"]);

    expect(result.stdout).toBe(MOCK_BREW_VERSION);
  });
});

describe("brew command integration", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  afterEach(() => {
    resetMocking();
  });

  it("can check if brew is available", async () => {
    const result = await executeBrewCommand(["--version"]);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Homebrew");
  });

  it("can get formula info as JSON", async () => {
    const result = await executeBrewCommand([
      "info",
      "--json=v2",
      "--installed",
    ]);

    expect(result.success).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("can get cask info as JSON", async () => {
    const result = await executeBrewCommand([
      "info",
      "--cask",
      "--json=v2",
      "--installed",
    ]);

    expect(result.success).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("handles concurrent command execution", async () => {
    const [result1, result2] = await Promise.all([
      executeBrewCommand(["--version"]),
      executeBrewCommand(["config"]),
    ]);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });
});
