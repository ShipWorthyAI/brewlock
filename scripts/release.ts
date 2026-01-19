#!/usr/bin/env bun

/**
 * Build a release binary for the current platform
 *
 * Usage:
 *   bun scripts/release.ts           # Build for current platform
 *   bun scripts/release.ts --tarball # Build and create tarball
 */

import { $ } from "bun";
import { existsSync, unlinkSync } from "node:fs";
import { arch, platform } from "node:os";

function getPlatformTarget(): string {
  const os = platform();
  const cpu = arch();

  const osName = os === "darwin" ? "darwin" : os === "linux" ? "linux" : os;
  const cpuName = cpu === "arm64" ? "arm64" : cpu === "x64" ? "x64" : cpu;

  return `${osName}-${cpuName}`;
}

async function build(): Promise<void> {
  const target = getPlatformTarget();
  const binaryName = "brewlock";
  const tarballName = `brewlock-${target}.tar.gz`;
  const createTarball = process.argv.includes("--tarball");

  console.log(`Building brewlock for ${target}...`);

  // Clean up previous builds
  if (existsSync(binaryName)) {
    unlinkSync(binaryName);
  }
  if (existsSync(tarballName)) {
    unlinkSync(tarballName);
  }

  // Build the binary
  await $`bun build src/index.ts --compile --outfile ${binaryName}`;
  console.log(`✓ Built ${binaryName}`);

  // Make executable
  await $`chmod +x ${binaryName}`;

  if (createTarball) {
    // Create tarball
    await $`tar -czvf ${tarballName} ${binaryName}`;
    console.log(`✓ Created ${tarballName}`);

    // Show SHA256
    const result = await $`shasum -a 256 ${tarballName}`.text();
    console.log(`\nSHA256: ${result.split(" ")[0]}`);
  }

  console.log("\n✓ Release build complete");
}

build().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
