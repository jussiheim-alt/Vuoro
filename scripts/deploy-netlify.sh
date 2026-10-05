#!/usr/bin/env bash
# Deploy Vuoro to Netlify (permanent URL + optional site password).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "NETLIFY_AUTH_TOKEN puuttuu." >&2
  echo "Luo Personal Access Token: https://app.netlify.com/user/applications#personal-access-tokens" >&2
  exit 1
fi

npm run build

ARGS=(deploy --prod --dir=dist --message "Vuoro deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)")
if [[ -n "${NETLIFY_SITE_ID:-}" ]]; then
  ARGS+=(--site "$NETLIFY_SITE_ID")
fi

# First-time: create site name if none linked
if [[ -z "${NETLIFY_SITE_ID:-}" && ! -f .netlify/state.json ]]; then
  ARGS+=(--create-site "vuoro-vaaksy")
fi

npx --yes netlify-cli "${ARGS[@]}"
