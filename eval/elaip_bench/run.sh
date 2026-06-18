#!/usr/bin/env bash
set -euo pipefail

CONFIG="${1:-default}"
shift || true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first" \
  npm run eval:elaip_bench -- --config "$CONFIG" "$@"
