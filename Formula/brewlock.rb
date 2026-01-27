# typed: false
# frozen_string_literal: true

class Brewlock < Formula
  desc "The missing lock file for Homebrew"
  homepage "https://github.com/ShipWorthyAI/brewlock"
  version "0.4.0"
  license "MIT"

  on_macos do
    depends_on arch: :arm64

    url "https://github.com/ShipWorthyAI/brewlock/releases/download/v0.4.0/brewlock-darwin-arm64.tar.gz"
    sha256 "e19df06692ad5ec993113b11f7053283bf9e89713b7fcbc417d62103ed58a8b3"
  end

  on_linux do
    depends_on arch: :x86_64

    url "https://github.com/ShipWorthyAI/brewlock/releases/download/v0.4.0/brewlock-linux-x64.tar.gz"
    sha256 "f5b32cf9d8cedef549e526e8bcf44a4432776cba62f43c2b58d8d2ded37f15e2"
  end

  def install
    bin.install "brewlock"
  end

  def caveats
    <<~EOS
      To use brewlock as a transparent wrapper for Homebrew, add this alias
      to your shell configuration:

      For zsh (add to ~/.zshrc):
        alias brew='brewlock'

      For bash (add to ~/.bashrc):
        alias brew='brewlock'

      For fish (add to ~/.config/fish/config.fish):
        alias brew 'brewlock'
    EOS
  end

  test do
    assert_match "brewlock - the missing lock file for Homebrew", shell_output("#{bin}/brewlock help")
  end
end
