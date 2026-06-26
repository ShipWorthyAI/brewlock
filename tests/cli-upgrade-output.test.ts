import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOCK_BREW = `#!/bin/sh
case "$*" in
  "upgrade")
    printf '%s\\n' 'Upgrading...'
    exit 0
    ;;
  "tap")
    printf '%s\\n' 'homebrew/core'
    exit 0
    ;;
  "tap-info --json homebrew/core")
    printf '%s\\n' '[{"name":"homebrew/core","HEAD":"abc123","remote":"https://github.com/Homebrew/homebrew-core","installed":true,"official":true,"formula_names":["git"],"cask_tokens":[]}]'
    exit 0
    ;;
  "info --json=v2 --installed")
    printf '%s\\n' '{"formulae":[{"name":"git","full_name":"git","tap":"homebrew/core","versions":{"stable":"2.43.0","head":null},"revision":0,"dependencies":[],"linked_keg":"2.43.0","pinned":false,"bottle":{"stable":{"files":{"arm64_sonoma":{"url":"https://ghcr.io/example","sha256":"abc123"}}}},"installed":[{"version":"2.43.0","installed_as_dependency":false,"installed_on_request":true}]}]}'
    exit 0
    ;;
  "info --cask --json=v2 --installed")
    printf '%s\\n' '{"casks":[]}'
    exit 0
    ;;
esac

printf '%s\\n' "unexpected brew command: $*" >&2
exit 1
`;

describe("CLI upgrade output", () => {
  it("prints one lockfile regeneration completion line", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "brewlock-cli-"));

    try {
      const mockBin = join(runDir, "bin");
      await mkdir(mockBin, { recursive: true });
      await writeFile(join(mockBin, "brew"), MOCK_BREW, { mode: 0o755 });

      const proc = Bun.spawn([process.execPath, "src/index.ts", "upgrade"], {
        cwd: join(import.meta.dir, ".."),
        env: {
          BREWLOCK: join(runDir, "brew.lock"),
          BREWLOCK_CASK_INFO_BACKEND: "brew",
          BREWLOCK_FORMULA_INFO_BACKEND: "brew",
          BREWLOCK_PERF: "0",
          BREWLOCK_TAP_INFO_BACKEND: "brew",
          PATH: mockBin,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);

      const regenerationLines = stdout
        .split("\n")
        .filter(
          (line) => line.includes("Lockfile") || line.includes("lock file")
        );

      expect(regenerationLines).toEqual([
        expect.stringMatching(/^Brewlock: Lockfile regenerated \(\d+\.\dms\)$/),
      ]);
    } finally {
      await rm(runDir, { force: true, recursive: true });
    }
  });
});
