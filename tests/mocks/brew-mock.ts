/**
 * Mock utilities for brew command execution
 * Uses Bun's mock.module() for proper test isolation
 */

import { mock } from "bun:test";

import type { ExecutionResult } from "../../src/types.ts";

/** Mock response configuration */
export interface MockBrewResponse {
  /** Command pattern to match (e.g., "info --json=v2 git") */
  pattern: RegExp | string;
  /** Response to return */
  response: ExecutionResult;
}

/** Global mock responses registry */
let mockResponses: MockBrewResponse[] = [];

/**
 * Add a mock response
 */
export function addMockResponse(
  pattern: RegExp | string,
  response: Partial<ExecutionResult>
): void {
  mockResponses.push({
    pattern,
    response: {
      exitCode: response.exitCode ?? 0,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      success:
        response.success ??
        (response.exitCode === 0 || response.exitCode === undefined),
    },
  });
}

/**
 * Clear all mock responses
 */
export function clearMockResponses(): void {
  mockResponses = [];
}

/**
 * Get a mock response for the given args
 */
export function getMockResponse(args: string[]): ExecutionResult {
  const argsString = args.join(" ");

  for (const mockItem of mockResponses) {
    if (typeof mockItem.pattern === "string") {
      if (argsString.includes(mockItem.pattern)) {
        return mockItem.response;
      }
    } else if (mockItem.pattern.test(argsString)) {
      return mockItem.response;
    }
  }

  // Default: command not found
  return {
    exitCode: 1,
    stdout: "",
    stderr: `Mock: No response configured for: brew ${argsString}`,
    success: false,
  };
}

// ============ Mock implementations ============

/**
 * Mock implementation of executeBrewCommand
 */
export const mockExecuteBrewCommand = mock(
  async (args: string[]): Promise<ExecutionResult> => {
    return getMockResponse(args);
  }
);

/**
 * Mock implementation of executeBrewCommandStreaming
 */
export const mockExecuteBrewCommandStreaming = mock(
  async (args: string[]): Promise<ExecutionResult> => {
    return getMockResponse(args);
  }
);

// ============ Sample mock data ============

/** Sample formula info JSON response */
export const MOCK_FORMULA_GIT_INFO = JSON.stringify({
  formulae: [
    {
      name: "git",
      full_name: "git",
      versions: { stable: "2.43.0", head: null },
      installed: [
        {
          version: "2.43.0",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      ],
    },
  ],
});

/** Sample formula not installed response */
export const MOCK_FORMULA_NOT_INSTALLED = JSON.stringify({
  formulae: [
    {
      name: "nonexistent",
      full_name: "nonexistent",
      versions: { stable: "1.0.0", head: null },
      installed: [],
    },
  ],
});

/** Sample all installed formulae response */
export const MOCK_ALL_FORMULAE = JSON.stringify({
  formulae: [
    {
      name: "git",
      full_name: "git",
      versions: { stable: "2.43.0", head: null },
      installed: [
        {
          version: "2.43.0",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      ],
    },
    {
      name: "node",
      full_name: "node",
      versions: { stable: "21.5.0", head: null },
      installed: [
        {
          version: "21.5.0",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      ],
    },
    {
      name: "python@3.11",
      full_name: "python@3.11",
      versions: { stable: "3.11.7", head: null },
      installed: [
        {
          version: "3.11.7_1",
          installed_as_dependency: false,
          installed_on_request: true,
        },
      ],
    },
  ],
});

/** Sample cask info response */
export const MOCK_CASK_DOCKER_INFO = JSON.stringify({
  casks: [
    {
      token: "docker",
      name: ["Docker Desktop"],
      version: "4.26.1",
      installed: "4.26.1",
    },
  ],
});

/** Sample cask not installed response */
export const MOCK_CASK_NOT_INSTALLED = JSON.stringify({
  casks: [
    {
      token: "nonexistent",
      name: ["Nonexistent App"],
      version: "1.0.0",
      installed: null,
    },
  ],
});

/** Sample all installed casks response */
export const MOCK_ALL_CASKS = JSON.stringify({
  casks: [
    {
      token: "docker",
      name: ["Docker Desktop"],
      version: "4.26.1",
      installed: "4.26.1",
    },
    {
      token: "visual-studio-code",
      name: ["Visual Studio Code"],
      version: "1.85.1",
      installed: "1.85.1",
    },
  ],
});

/** Sample tap list response */
export const MOCK_TAP_LIST = `homebrew/core
homebrew/cask
homebrew/bundle`;

/** Sample brew version response */
export const MOCK_BREW_VERSION = "Homebrew 4.2.0";

/** Sample brew config response */
export const MOCK_BREW_CONFIG = `HOMEBREW_VERSION: 4.2.0
ORIGIN: https://github.com/Homebrew/brew
HEAD: abc123
Core tap HEAD: def456`;

/**
 * Setup common mock responses for testing
 */
export function setupCommonMocks(): void {
  clearMockResponses();

  // Version command
  addMockResponse("--version", { stdout: MOCK_BREW_VERSION, exitCode: 0 });

  // Config command
  addMockResponse("config", { stdout: MOCK_BREW_CONFIG, exitCode: 0 });

  // Tap list
  addMockResponse(/^tap$/, { stdout: MOCK_TAP_LIST, exitCode: 0 });

  // Formula info for specific packages
  addMockResponse(/info --json=v2 git$/, {
    stdout: MOCK_FORMULA_GIT_INFO,
    exitCode: 0,
  });
  addMockResponse(/info --json=v2 nonexistent/, {
    stdout: MOCK_FORMULA_NOT_INSTALLED,
    exitCode: 1,
    stderr: "Error: No formula found",
  });

  // All installed formulae
  addMockResponse("info --json=v2 --installed", {
    stdout: MOCK_ALL_FORMULAE,
    exitCode: 0,
  });

  // Cask info
  addMockResponse(/info --cask --json=v2 docker$/, {
    stdout: MOCK_CASK_DOCKER_INFO,
    exitCode: 0,
  });
  addMockResponse(/info --cask --json=v2 nonexistent/, {
    stdout: MOCK_CASK_NOT_INSTALLED,
    exitCode: 1,
  });
  addMockResponse("info --cask --json=v2 --installed", {
    stdout: MOCK_ALL_CASKS,
    exitCode: 0,
  });

  // Install commands (simulated success)
  addMockResponse(/^install\s/, {
    stdout: "==> Installing...\n==> Done!",
    exitCode: 0,
  });
  addMockResponse(/^install --cask\s/, {
    stdout: "==> Installing cask...\n==> Done!",
    exitCode: 0,
  });

  // Tap commands
  addMockResponse(/^tap homebrew\//, {
    stdout: "==> Tapping homebrew/...",
    exitCode: 0,
  });
  addMockResponse(/^untap\s/, { stdout: "Untapping...", exitCode: 0 });

  // Uninstall commands
  addMockResponse(/^uninstall\s/, { stdout: "Uninstalling...", exitCode: 0 });
  addMockResponse(/^remove\s/, { stdout: "Removing...", exitCode: 0 });
  addMockResponse(/^rm\s/, { stdout: "Removing...", exitCode: 0 });

  // Upgrade commands
  addMockResponse(/^upgrade/, { stdout: "Upgrading...", exitCode: 0 });

  // List commands
  addMockResponse("list --formula", {
    stdout: "git\nnode\npython@3.11",
    exitCode: 0,
  });
  addMockResponse("list --cask", {
    stdout: "docker\nvisual-studio-code",
    exitCode: 0,
  });
  addMockResponse(/^list$/, { stdout: "git\nnode\npython@3.11", exitCode: 0 });
  addMockResponse("list --formula mas", { stdout: "mas", exitCode: 0 });

  // Search/info passthrough commands
  addMockResponse(/^search\s/, { stdout: "Search results...", exitCode: 0 });
  addMockResponse(/^doctor$/, {
    stdout: "Your system is ready to brew.",
    exitCode: 0,
  });
  addMockResponse(/^outdated$/, { stdout: "", exitCode: 0 });
  addMockResponse(/^update$/, { stdout: "Already up-to-date.", exitCode: 0 });
  addMockResponse(/^deps\s/, { stdout: "", exitCode: 0 });
  addMockResponse(/^uses\s/, { stdout: "", exitCode: 0 });

  // Invalid command
  addMockResponse("invalid-command", {
    exitCode: 1,
    stderr: "Unknown command: invalid-command",
  });
}

/**
 * Reset mocking state completely
 */
export function resetMocking(): void {
  clearMockResponses();
  mockExecuteBrewCommand.mockClear();
  mockExecuteBrewCommandStreaming.mockClear();
}

/**
 * Setup the executor module mock.
 * Call this BEFORE importing modules that depend on the executor.
 */
export function setupExecutorMock(): void {
  mock.module("../src/executor.ts", () => ({
    executeBrewCommand: mockExecuteBrewCommand,
    executeBrewCommandStreaming: mockExecuteBrewCommandStreaming,
  }));
}
