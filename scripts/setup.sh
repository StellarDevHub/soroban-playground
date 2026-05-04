#!/usr/bin/env bash
# setup.sh - initialize environment for new contributors
# Supports Linux and macOS

set -euo pipefail
IFS=$'\n\t'

ESC_RED="\033[0;31m"
ESC_GREEN="\033[0;32m"
ESC_YELLOW="\033[0;33m"
ESC_NONE="\033[0m"

info() { printf "%b\n" "${ESC_GREEN}[INFO]${ESC_NONE} $*"; }
warn() { printf "%b\n" "${ESC_YELLOW}[WARN]${ESC_NONE} $*"; }
fail() { printf "%b\n" "${ESC_RED}[ERROR]${ESC_NONE} $*"; }

[[ -t 1 ]] && TERM_IS_TTY=1 || TERM_IS_TTY=0
if [[ ${TERM_IS_TTY} -eq 0 ]]; then
  ESC_RED=""; ESC_GREEN=""; ESC_YELLOW=""; ESC_NONE=""
fi

echo
info "Soroban Playground setup script"

platform="$(uname -s)"
case "$platform" in
  Linux*)   os_name="Linux" ;; 
  Darwin*)  os_name="macOS" ;; 
  *)        os_name="Unknown" ;; 
esac

info "Detected OS: ${os_name}"

dependencies=(node npm rustc cargo soroban)
missing=()

for dep in "${dependencies[@]}"; do
  if ! command -v "$dep" > /dev/null 2>&1; then
    missing+=("$dep")
  else
    info "$dep is installed: $(command -v $dep)"
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  fail "Missing dependencies: ${missing[*]}"
  echo
  echo "Please install the missing dependencies and re-run ./setup.sh"
  echo

  for dep in "${missing[@]}"; do
    case "$dep" in
      node)
        echo "- node: https://nodejs.org/"
        echo "    macOS: brew install node"
        echo "    Linux (Ubuntu/Debian): sudo apt update && sudo apt install -y nodejs npm"
        echo "    Alternatively: nvm install --lts"
        ;;
      npm)
        echo "- npm: installed with Node.js. If Node is installed and npm missing, fix the Node installation."
        ;;
      rustc|cargo)
        echo "- Rust toolchain: https://www.rust-lang.org/tools/install"
        echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        ;;
      soroban)
        echo "- Soroban CLI: https://soroban.stellar.org/docs/getting-started/cli"
        echo "    cargo install --locked soroban-cli"
        echo "    or on macOS: brew install soroban-cli"
        ;;
      *)
        echo "- $dep: please install"
        ;;
    esac
    echo
  done
  exit 1
fi

info "All prerequisites found. Installing npm dependencies..."

if command -v npm > /dev/null 2>&1; then
  npm install
  info "npm dependencies installed."
else
  fail "npm command not found; cannot install packages."
  exit 1
fi

info "Setup completed successfully."
info "Run 'npm run dev' to start the app stack."
