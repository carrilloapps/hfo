#!/usr/bin/env sh
# hfo install script for Linux and macOS.
#
# Usage:
#   curl -fsSL https://hfo.carrillo.app/install.sh | sh
#
# Downloads the latest release binary for your OS + architecture from
# https://github.com/carrilloapps/hfo/releases/latest and installs it to a
# writable location on your PATH. Prefers /usr/local/bin; falls back to
# ~/.local/bin (and hints at PATH setup if your shell doesn't already have
# it). No sudo required unless you opt into /usr/local/bin.
#
# Override defaults via environment variables:
#   HFO_VERSION=v0.2.0          install a specific tag (default: latest)
#   HFO_INSTALL_DIR=/some/dir   install to a custom directory

set -e

REPO="carrilloapps/hfo"
VERSION="${HFO_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  RELEASE_PATH="releases/latest/download"
else
  RELEASE_PATH="releases/download/${VERSION}"
fi

# --- Detect platform ---------------------------------------------------
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux)   OS_SLUG="linux"  ;;
  darwin)  OS_SLUG="macos"  ;;
  *)
    printf "hfo: unsupported OS \"%s\". Try the npm install instead:\n  npm i -g hfo-cli\n" "$OS" >&2
    exit 1 ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)    ARCH_SLUG="x64"   ;;
  aarch64|arm64)   ARCH_SLUG="arm64" ;;
  *)
    printf "hfo: unsupported architecture \"%s\". Try the npm install instead:\n  npm i -g hfo-cli\n" "$ARCH" >&2
    exit 1 ;;
esac

ASSET="hfo-${OS_SLUG}-${ARCH_SLUG}"
URL="https://github.com/${REPO}/${RELEASE_PATH}/${ASSET}"

# --- Pick destination --------------------------------------------------
if [ -n "${HFO_INSTALL_DIR:-}" ]; then
  DEST_DIR="$HFO_INSTALL_DIR"
  mkdir -p "$DEST_DIR"
elif [ -w "/usr/local/bin" ]; then
  DEST_DIR="/usr/local/bin"
elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  DEST_DIR="$HOME/.local/bin"
else
  printf "hfo: no writable install directory found. Re-run with sudo, or set HFO_INSTALL_DIR.\n" >&2
  exit 1
fi

DEST="$DEST_DIR/hfo"

# --- Download ----------------------------------------------------------
printf "hfo: downloading %s\n" "$ASSET"
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$DEST.tmp" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$DEST.tmp" "$URL"
else
  printf "hfo: neither curl nor wget found; aborting.\n" >&2
  exit 1
fi

chmod +x "$DEST.tmp"
mv "$DEST.tmp" "$DEST"
printf "hfo: installed %s\n" "$DEST"

# --- PATH check --------------------------------------------------------
case ":$PATH:" in
  *":$DEST_DIR:"*) ;;
  *)
    printf "\nhfo: %s is not on your PATH. Add this line to your shell profile:\n" "$DEST_DIR"
    printf "    export PATH=\"%s:\$PATH\"\n" "$DEST_DIR"
    ;;
esac

# --- Verify + hint -----------------------------------------------------
"$DEST" --version 2>/dev/null || true
printf "\nhfo: run 'hfo' to open the TUI, or 'hfo --help' for the CLI reference.\n"
