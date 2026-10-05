#!/usr/bin/env bash
# Publish Vuoro to the permanent hostthis.dev site.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLUG_FILE="$ROOT/data/HOSTTHIS_SLUG"
SLUG="${HOSTTHIS_SLUG:-}"
if [[ -z "$SLUG" && -f "$SLUG_FILE" ]]; then
  SLUG="$(tr -d '[:space:]' < "$SLUG_FILE")"
fi
if [[ -z "$SLUG" ]]; then
  echo "Missing slug. Set HOSTTHIS_SLUG or create data/HOSTTHIS_SLUG" >&2
  exit 1
fi

cd "$ROOT"
npm run build
URL="$(tar czf - -C dist . | ssh -o StrictHostKeyChecking=accept-new -T hostthis.dev "$SLUG" 2>/dev/null | head -1)"
echo "$URL"
echo "$SLUG" > "$SLUG_FILE"
