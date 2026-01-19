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
- **Full package support**: Tracks formulae, casks, taps, and Mac App Store apps

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

The lock file uses standard Brewfile syntax with added version information:

```ruby
# brewlock v1
tap "homebrew/cask"
tap "homebrew/bundle"

brew "git", version: "2.43.0"
brew "node", version: "21.5.0"
brew "python@3.11", version: "3.11.7_1"

cask "docker", version: "4.26.1"
cask "visual-studio-code", version: "1.85.1"

mas "Xcode", id: 497799835, version: "15.2"
```

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
    index.ts          # CLI entry point
    parser.ts         # Command parser
    executor.ts       # Brew command executor
    lock-manager.ts   # Lock file read/write
    version-resolver.ts # Version querying
    bundle-handler.ts # Bundle install with versions
    types.ts          # Shared type definitions
  tests/
    mocks/            # Test mocking utilities
    *.test.ts         # Test files
  package.json
  tsconfig.json
```

## License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Created by <a href="https://shipworthy.ai">ShipWorthy</a> ⛵️
</p>
