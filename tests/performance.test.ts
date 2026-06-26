import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  getPerformanceLogPath,
  isPerformanceTracingEnabled,
  measurePerformance,
} from "../src/performance.ts";

interface LoggedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  durationMs: number;
  success: boolean;
  attributes: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
  };
}

const TEST_DIR = join(import.meta.dir, ".test-temp", "performance");
const TEST_LOG_FILE = join(TEST_DIR, "performance.ndjson");

const ORIGINAL_BREWLOCK_PERF = process.env.BREWLOCK_PERF;
const ORIGINAL_BREWLOCK_PERF_LOG = process.env.BREWLOCK_PERF_LOG;

describe("performance tracing", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
    process.env.BREWLOCK_PERF = "0";
    process.env.BREWLOCK_PERF_LOG = TEST_LOG_FILE;
  });

  afterEach(async () => {
    restoreEnvironment();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("can be disabled explicitly", async () => {
    expect(isPerformanceTracingEnabled()).toBe(false);
    expect(getPerformanceLogPath()).toBe(TEST_LOG_FILE);

    const result = await measurePerformance(
      "test.disabled",
      {},
      async () => "ok"
    );

    expect(result).toBe("ok");
    expect(await Bun.file(TEST_LOG_FILE).exists()).toBe(false);
  });

  it("is enabled by default", async () => {
    delete process.env.BREWLOCK_PERF;

    expect(isPerformanceTracingEnabled()).toBe(true);

    const result = await measurePerformance(
      "test.default-enabled",
      {},
      async () => "ok"
    );

    expect(result).toBe("ok");
    const entries = await readLogEntries();
    expect(entries.some((entry) => entry.name === "test.default-enabled")).toBe(
      true
    );
  });

  it("writes nested spans as newline-delimited JSON", async () => {
    process.env.BREWLOCK_PERF = "1";

    const result = await measurePerformance(
      "test.outer",
      { command: "install", packageCount: 1 },
      async (outerSpan) => {
        outerSpan.setAttribute("phase", "outer");
        return measurePerformance(
          "test.inner",
          { packageName: "git" },
          async (innerSpan) => {
            innerSpan.setAttribute("phase", "inner");
            return "done";
          }
        );
      }
    );

    expect(result).toBe("done");

    const entries = await readLogEntries();
    const outer = entries.find((entry) => entry.name === "test.outer");
    const inner = entries.find((entry) => entry.name === "test.inner");

    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(outer?.success).toBe(true);
    expect(inner?.success).toBe(true);
    expect(outer?.durationMs).toBeGreaterThanOrEqual(0);
    expect(inner?.durationMs).toBeGreaterThanOrEqual(0);
    expect(outer?.attributes.command).toBe("install");
    expect(outer?.attributes.phase).toBe("outer");
    expect(inner?.attributes.packageName).toBe("git");
    expect(inner?.attributes.phase).toBe("inner");
    expect(inner?.parentSpanId).toBe(outer?.spanId);
    expect(inner?.traceId).toBe(outer?.traceId);
  });

  it("records thrown errors before rethrowing", async () => {
    process.env.BREWLOCK_PERF = "1";

    await expect(
      measurePerformance("test.failure", {}, async () => {
        throw new Error("expected failure");
      })
    ).rejects.toThrow("expected failure");

    const entries = await readLogEntries();
    const failure = entries.find((entry) => entry.name === "test.failure");

    expect(failure).toBeDefined();
    expect(failure?.success).toBe(false);
    expect(failure?.error?.name).toBe("Error");
    expect(failure?.error?.message).toBe("expected failure");
  });
});

async function readLogEntries(): Promise<LoggedSpan[]> {
  const content = await readFile(TEST_LOG_FILE, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedSpan);
}

function restoreEnvironment(): void {
  if (ORIGINAL_BREWLOCK_PERF === undefined) {
    delete process.env.BREWLOCK_PERF;
  } else {
    process.env.BREWLOCK_PERF = ORIGINAL_BREWLOCK_PERF;
  }

  if (ORIGINAL_BREWLOCK_PERF_LOG === undefined) {
    delete process.env.BREWLOCK_PERF_LOG;
  } else {
    process.env.BREWLOCK_PERF_LOG = ORIGINAL_BREWLOCK_PERF_LOG;
  }
}
