#!/usr/bin/env bun

import { $ } from "bun";
import { chmod, mkdir, rm } from "node:fs/promises";
import { platform } from "node:os";
import { dirname } from "node:path";

/** Build a fresh executable and sign its final contents on macOS. */
export async function buildBinary(outfile: string): Promise<void> {
  await mkdir(dirname(outfile), { recursive: true });
  await rm(outfile, { force: true });
  await $`${process.execPath} build src/index.ts --compile --outfile ${outfile}`;
  await chmod(outfile, 0o755);

  if (platform() === "darwin") {
    await $`codesign --force --sign - ${outfile}`;
    await $`codesign --verify --strict ${outfile}`;
  }
}

if (import.meta.main) {
  await buildBinary("dist/brewlock");
}
