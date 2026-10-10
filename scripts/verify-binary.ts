#!/usr/bin/env bun

import { $ } from "bun";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MOCK_BREW = `#!/bin/sh
case "$*" in
  "outdated --greedy")
    printf '%s\\n' 'outdated package'
    printf '%s\\n' 'brew diagnostic' >&2
    exit 0
    ;;
  "outdated --formula")
    printf '%s\\n' 'partial output'
    printf '%s\\n' 'brew failure' >&2
    exit 7
    ;;
esac
printf '%s\\n' "unexpected brew command: $*" >&2
exit 99
`;

/** Check the executable that users actually run, without touching Homebrew. */
export async function verifyBinary(binaryPath: string): Promise<void> {
  const binary = resolve(binaryPath);
  if (platform() === "darwin") {
    await $`codesign --verify --strict ${binary}`;
  }

  const fixture = await mkdtemp(join(tmpdir(), "brewlock-binary-"));
  try {
    const lockFile = join(fixture, "brew.lock");
    const lockContents = "# Binary verification: this file must not change.\n";
    await writeFile(lockFile, lockContents);
    await writeFile(join(fixture, "brew"), MOCK_BREW, { mode: 0o755 });
    const env = {
      ...process.env,
      BREWLOCK: lockFile,
      BREWLOCK_PERF: "0",
      PATH: `${fixture}:/usr/bin:/bin`,
    };

    const help = await $`${binary} --help`.env(env).quiet().nothrow();
    assert.equal(help.exitCode, 0, "compiled --help must succeed");
    assert.match(help.text(), /A version-locking wrapper for Homebrew/);

    const success = await $`${binary} outdated --greedy`
      .env(env)
      .quiet()
      .nothrow();
    assert.equal(success.exitCode, 0, "brew exit status must pass through");
    assert.equal(success.text(), "outdated package\n");
    assert.equal(success.stderr.toString(), "brew diagnostic\n");

    const failure = await $`${binary} outdated --formula`
      .env(env)
      .quiet()
      .nothrow();
    assert.equal(failure.exitCode, 7, "brew failures must pass through");
    assert.equal(failure.text(), "partial output\n");
    assert.equal(failure.stderr.toString(), "brew failure\n");
    assert.equal(await readFile(lockFile, "utf8"), lockContents);
    console.log(`✓ Verified compiled CLI: ${binaryPath}`);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  await verifyBinary(process.argv[2] ?? "dist/brewlock");
}
