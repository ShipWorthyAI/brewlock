<p align="center">
  <img src="./.github/brewlock.png" alt="brewlock" width="200" />
</p>

<h1 align="center">🍺 brewlock 🔒</h1>

<p align="center">
  A version-locking wrapper for Homebrew that maintains a <code>brew.lock</code> file containing exact versions of all installed packages, enabling reproducible installations across machines.
</p>

## Features

- **Transparent wrapper**: Alias `brewlock` to `brew` and use Homebrew normally
- **Automatic version tracking**: Every install/uninstall/upgrade updates `brew.lock`
- **Version-locked bundle install**: Install packages with version verification
- **Full package support**: Tracks formulae, casks, taps (with commit SHAs), and Mac App Store apps
- **JSONC format**: Human-readable lock file with comment support
- **Custom tap URLs**: Tracks custom tap repository URLs for reproducibility

## Installation

### Homebrew (recommended)

```bash
brew tap shipworthyai/brewlock https://github.com/ShipWorthyAI/brewlock.git
brew install brewlock
```

> **Note:** Currently only supports Apple Silicon Macs (arm64).

### From Source

If you want to build from source or contribute to development:

```bash
# Clone the repository
git clone https://github.com/ShipWorthyAI/brewlock.git
cd brewlock

# Install dependencies
bun install

# Build the binary
bun run build

# Or link for development
bun link
```

## Setup

Add this alias to your shell configuration to use brewlock as a transparent wrapper for Homebrew:

```bash
# For zsh (add to ~/.zshrc):
alias brew='brewlock'

# For bash (add to ~/.bashrc):
alias brew='brewlock'

# For fish (add to ~/.config/fish/config.fish):
alias brew 'brewlock'
```

After adding the alias, restart your shell or run `source ~/.zshrc` (or equivalent).

## Quick Start

```bash
# Install brewlock
brew tap shipworthyai/brewlock https://github.com/ShipWorthyAI/brewlock.git
brew install brewlock

# Set up the alias (add to your ~/.zshrc)
echo "alias brew='brewlock'" >> ~/.zshrc
source ~/.zshrc

# Generate a lock file from your current packages
brew lock

# Use brew normally - brewlock tracks versions automatically
brew install git
brew install --cask docker
```

## Usage

### Normal Homebrew Commands

All standard brew commands work transparently:

```bash
brew install git              # Installs git and updates brew.lock
brew install --cask docker    # Installs Docker and updates brew.lock
brew upgrade                  # Upgrades all and regenerates brew.lock
brew uninstall node           # Removes node and updates brew.lock
```

### Brewlock-Specific Commands

```bash
brew lock     # Generate brew.lock from currently installed packages
brew check    # Verify installed versions match brew.lock
brew help     # Show help message (or brewlock help for brewlock-specific help)
```

### Bundle Install with Version Verification

```bash
brew bundle install    # Installs from brew.lock with version checking
```

### Syncing Across Machines

```bash
# Option 1: Point BREWLOCK directly to your dotfiles (recommended)
# Add to your shell config (~/.zshrc or ~/.bashrc):
export BREWLOCK="$HOME/dotfiles/brew.lock"

# Option 2: Copy (or symlink) the lock file to your dotfiles
cp ~/brew.lock ~/dotfiles/
cd ~/dotfiles && git add brew.lock && git commit -m "Update brew.lock"

# On a new machine: restore from brew.lock
cp ~/dotfiles/brew.lock ~/brew.lock
brew bundle install
```

## The `brew.lock` File

By default, the lock file is stored at `~/brew.lock` (in your home directory). You can customize this location using the `BREWLOCK` environment variable:

```bash
# Set a custom lock file path
export BREWLOCK=/path/to/your/brew.lock

# Example: Store in your dotfiles repo
export BREWLOCK="$HOME/dotfiles/brew.lock"
```

The lock file uses JSONC (JSON with Comments) format, organized by package type:

```jsonc
{
  "version": 1,
  "tap": {
    "homebrew/core": {
      "commit": "a1b2c3d4e5f6...",
      "official": true
    },
    "homebrew/cask": {
      "commit": "f6e5d4c3b2a1...",
      "official": true
    },
    "shipworthyai/brewlock": {
      "url": "https://github.com/ShipWorthyAI/brewlock.git",
      "commit": "abc123def456..."
    }
  },
  "brew": {
    "git": {
      "version": "2.52.0",
      "installed": ["2.52.0", "2.51.0"],
      "revision": 1,
      "tap": "homebrew/core",
      "pinned": false,
      "dependencies": ["gettext", "pcre2"],
      "sha256": "c19806bab...",
      "installed_as_dependency": false,
      "installed_on_request": true
    },
    "node": {
      "version": "21.5.0",
      "tap": "homebrew/core",
      "installed_on_request": true
    }
  },
  "cask": {
    "docker": {
      "version": "4.26.1,123456",
      "tap": "homebrew/cask",
      "sha256": "0a55468...",
      "auto_updates": true
    },
    "visual-studio-code": {
      "version": "1.85.1",
      "tap": "homebrew/cask",
      "auto_updates": true
    }
  },
  "mas": {
    "Xcode": {
      "id": 497799835,
      "version": "15.2"
    }
  }
}
```

### Lock File Fields

#### Tap Fields

| Field | Description |
|-------|-------------|
| `url` | Custom GitHub repo URL (for non-official taps) |
| `commit` | Git commit SHA for reproducibility |
| `official` | Whether this is an official Homebrew tap |

#### Brew (Formula) Fields

| Field | Description |
|-------|-------------|
| `version` | Linked (active) version |
| `installed` | All installed versions in Cellar (if multiple) |
| `revision` | Formula revision (e.g., distinguishes `2.43.0` from `2.43.0_1`) |
| `tap` | Source tap (e.g., `homebrew/core`) |
| `pinned` | Whether the formula is pinned |
| `dependencies` | Direct dependencies |
| `sha256` | Platform-specific bottle SHA256 for verification |
| `installed_as_dependency` | Whether installed as a dependency of another package |
| `installed_on_request` | Whether user explicitly installed it |

#### Cask Fields

| Field | Description |
|-------|-------------|
| `version` | Installed cask version |
| `tap` | Source tap (e.g., `homebrew/cask`) |
| `sha256` | Download SHA256 for verification |
| `auto_updates` | Whether the app self-updates |

#### Mac App Store (mas) Fields

| Field | Description |
|-------|-------------|
| `id` | App Store ID (required for installation) |
| `version` | Installed app version |

## How It Works

1. **Command Interception**: brewlock parses brew commands to detect package modifications
2. **Passthrough Execution**: The actual brew command is executed with live output streaming
3. **Lock File Update**: After successful commands, brewlock queries installed versions and updates `brew.lock`
4. **Bundle Install**: When running `brew bundle install`, brewlock checks versions and warns about mismatches

## Version Installation Strategy

Homebrew doesn't natively support exact version installation for all packages. brewlock handles this pragmatically:

- **Versioned formulae**: Uses `brew install package@version` syntax when available (e.g., `python@3.11`)
- **Current version match**: Skips installation if the installed version matches the lock file
- **Version mismatch**: Warns when the installed version differs from the lock file
- **Casks**: Tracks versions but casks are typically pinned by their formula

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Lint
bun run lint

# Type check
bun run typecheck

# Build binary
bun run build

# Run the CLI directly (without building)
bun run src/index.ts --help

# Build release tarball
bun run build:release
```

## Project Structure

```
brewlock/
  src/
    index.ts           # CLI entry point
    parser.ts          # Command parser
    executor.ts        # Brew command executor
    lock-manager.ts    # Lock file read/write (JSONC format)
    version-resolver.ts # Version querying
    bundle-install.ts  # Bundle install with versions
    types.ts           # Shared type definitions
  tests/
    mocks/             # Test mocking utilities
    *.test.ts          # Test files
  package.json
  tsconfig.json
```

## License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Created by <a href="https://shipworthy.ai">ShipWorthy</a> ⛵️
</p>
