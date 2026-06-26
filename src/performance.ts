/**
 * Performance tracing for brewlock.
 *
 * Tracing is enabled by default and appends JSON spans to disk. Set
 * BREWLOCK_PERF=0 to disable it. Set BREWLOCK_PERF_LOG to choose the
 * destination path.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

/** Default performance log path */
export const DEFAULT_PERFORMANCE_LOG_FILE = join(
  homedir(),
  ".brewlock",
  "performance.ndjson"
);

type PerformanceAttributeValue = string | number | boolean | null;

/** Attributes included on a performance span */
export type PerformanceAttributes = Record<
  string,
  PerformanceAttributeValue | undefined
>;

/** Mutable span handle available while measured work is running */
export interface PerformanceSpan {
  readonly spanId: string;
  readonly traceId: string;
  setAttribute(
    name: string,
    value: PerformanceAttributeValue | undefined
  ): void;
  setAttributes(attributes: PerformanceAttributes): void;
}

interface PerformanceSpanContext {
  parentSpanId?: string;
  spanId: string;
  traceId: string;
}

interface PerformanceSpanLog {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  attributes: Record<string, PerformanceAttributeValue>;
  error?: {
    name: string;
    message: string;
  };
}

const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const spanContext = new AsyncLocalStorage<PerformanceSpanContext>();
let nextSpanId = 0;
let reportedLogWriteFailure = false;

const noopSpan: PerformanceSpan = {
  spanId: "disabled",
  traceId: "disabled",
  setAttribute() {},
  setAttributes() {},
};

/** Return whether performance tracing is active for this process */
export function isPerformanceTracingEnabled(): boolean {
  const flag = process.env.BREWLOCK_PERF?.trim().toLowerCase();

  if (flag) {
    return !DISABLED_VALUES.has(flag);
  }

  return true;
}

/** Return the active performance log path */
export function getPerformanceLogPath(): string {
  return process.env.BREWLOCK_PERF_LOG ?? DEFAULT_PERFORMANCE_LOG_FILE;
}

/**
 * Measure an async operation and append one NDJSON span when tracing is enabled.
 * When tracing is disabled, this only invokes the operation with a no-op span.
 */
export async function measurePerformance<T>(
  name: string,
  attributes: PerformanceAttributes,
  operation: (span: PerformanceSpan) => Promise<T>
): Promise<T> {
  if (!isPerformanceTracingEnabled()) {
    return operation(noopSpan);
  }

  const parentContext = spanContext.getStore();
  const context: PerformanceSpanContext = {
    traceId: parentContext?.traceId ?? createTraceId(),
    spanId: createSpanId(),
    parentSpanId: parentContext?.spanId,
  };
  const spanAttributes = sanitizeAttributes(attributes);
  const span = createSpan(context, spanAttributes);
  const startTime = performance.now();
  const startedAt = new Date().toISOString();

  return spanContext.run(context, async () => {
    let success = false;
    let caughtError: unknown;

    try {
      const result = await operation(span);
      success = true;
      return result;
    } catch (error) {
      caughtError = error;
      throw error;
    } finally {
      const entry: PerformanceSpanLog = {
        schemaVersion: 1,
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: context.parentSpanId,
        name,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Number((performance.now() - startTime).toFixed(3)),
        success,
        attributes: spanAttributes,
      };

      if (!success && caughtError !== undefined) {
        entry.error = errorToLog(caughtError);
      }

      await appendPerformanceLog(entry);
    }
  });
}

function createTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${process.pid}-${random}`;
}

function createSpanId(): string {
  nextSpanId += 1;
  return nextSpanId.toString(36);
}

function createSpan(
  context: PerformanceSpanContext,
  attributes: Record<string, PerformanceAttributeValue>
): PerformanceSpan {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    setAttribute(name, value) {
      if (value === undefined) {
        delete attributes[name];
        return;
      }
      attributes[name] = value;
    },
    setAttributes(nextAttributes) {
      for (const [name, value] of Object.entries(nextAttributes)) {
        this.setAttribute(name, value);
      }
    },
  };
}

function sanitizeAttributes(
  attributes: PerformanceAttributes
): Record<string, PerformanceAttributeValue> {
  const sanitized: Record<string, PerformanceAttributeValue> = {};

  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      sanitized[name] = value;
    }
  }

  return sanitized;
}

async function appendPerformanceLog(entry: PerformanceSpanLog): Promise<void> {
  const logPath = getPerformanceLogPath();

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    if (reportedLogWriteFailure) {
      return;
    }

    reportedLogWriteFailure = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `brewlock: Failed to write performance log to ${logPath}: ${message}`
    );
  }
}

function errorToLog(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}
