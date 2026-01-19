# typed: false
# frozen_string_literal: true

class Brewlock < Formula
  desc "The missing lock file for Homebrew"
  homepage "https://github.com/ShipWorthyAI/brewlock"
  version "0.2.0"
  license "MIT"

  depends_on arch: :arm64
  depends_on :macos

  url "https://github.com/ShipWorthyAI/brewlock/releases/download/v0.2.0/brewlock-darwin-arm64.tar.gz"
  sha256 "ecd86a91d9696aec3871fc676f894b3e506a3e120703e5729c6bee74abb8092c"

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
