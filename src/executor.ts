/**
 * Brew command executor using Bun shell
 */

import type { ExecutionResult } from "./types.ts";
import { measurePerformance } from "./performance.ts";

/**
 * Execute a brew command and return the result
 */
export async function executeBrewCommand(
  args: string[]
): Promise<ExecutionResult> {
  return measurePerformance(
    "brew.execute",
    {
      argCount: args.length,
      command: args.join(" "),
      streaming: false,
    },
    async (span) => {
      try {
        const proc = Bun.spawn(["brew", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        const exitCode = await proc.exited;
        span.setAttributes({
          commandSuccess: exitCode === 0,
          exitCode,
          stderrBytes: stderr.length,
          stdoutBytes: stdout.length,
        });

        return {
          exitCode,
          stdout,
          stderr,
          success: exitCode === 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.setAttributes({
          commandSuccess: false,
          error: message,
          exitCode: 1,
          stderrBytes: message.length,
          stdoutBytes: 0,
        });

        return {
          exitCode: 1,
          stdout: "",
          stderr: message,
          success: false,
        };
      }
    }
  );
}

/**
 * Execute a brew command with live output streaming
 */
export async function executeBrewCommandStreaming(
  args: string[]
): Promise<ExecutionResult> {
  return measurePerformance(
    "brew.execute",
    {
      argCount: args.length,
      command: args.join(" "),
      streaming: true,
    },
    async (span) => {
      try {
        const proc = Bun.spawn(["brew", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });

        // Collect output while streaming
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];

        // Create readers for both streams
        const stdoutReader = proc.stdout.getReader();
        const stderrReader = proc.stderr.getReader();
        const decoder = new TextDecoder();

        // Read and stream stdout
        const readStdout = async () => {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            const text = decoder.decode(value);
            stdoutChunks.push(text);
            process.stdout.write(text);
          }
        };

        // Read and stream stderr
        const readStderr = async () => {
          while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;
            const text = decoder.decode(value);
            stderrChunks.push(text);
            process.stderr.write(text);
          }
        };

        // Wait for all operations to complete
        await Promise.all([readStdout(), readStderr()]);

        const exitCode = await proc.exited;
        const stdout = stdoutChunks.join("");
        const stderr = stderrChunks.join("");
        span.setAttributes({
          commandSuccess: exitCode === 0,
          exitCode,
          stderrBytes: stderr.length,
          stdoutBytes: stdout.length,
        });

        return {
          exitCode,
          stdout,
          stderr,
          success: exitCode === 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.setAttributes({
          commandSuccess: false,
          error: message,
          exitCode: 1,
          stderrBytes: message.length,
          stdoutBytes: 0,
        });

        return {
          exitCode: 1,
          stdout: "",
          stderr: message,
          success: false,
        };
      }
    }
  );
}
