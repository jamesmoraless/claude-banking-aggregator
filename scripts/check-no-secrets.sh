#!/usr/bin/env bash
#
# Fails if anything that looks like a real credential is tracked in git.
#
# This is a backstop, not a substitute for care. It catches the specific shapes
# of secret this project handles: Plaid tokens, Anthropic keys, Supabase secret
# keys and service-role JWTs, plus committed .env files.
#
# Usage: ./scripts/check-no-secrets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0

report() {
  echo "FAIL: $1" >&2
  FAILED=1
}

# Files that legitimately document variable NAMES and patterns.
EXCLUDES=(
  ':(exclude).env.example'
  ':(exclude)MANUAL_SETUP.md'
  ':(exclude)README.md'
  ':(exclude)ARCHITECTURE.md'
  ':(exclude)scripts/check-no-secrets.sh'
  ':(exclude)src/lib/logger.ts'
  ':(exclude)supabase/functions/_shared/**/redact*'
)

search() {
  local pattern="$1"
  git grep -nIE "$pattern" -- . "${EXCLUDES[@]}" 2>/dev/null || true
}

echo "==> scanning tracked files for credential patterns"

# Plaid access / public / link tokens.
HITS="$(search 'access-(sandbox|development|production)-[0-9a-f]{8}')"
[[ -n "$HITS" ]] && report "Plaid access token found:"$'\n'"$HITS"

HITS="$(search '(public|link)-(sandbox|development|production)-[0-9a-f]{8}')"
[[ -n "$HITS" ]] && report "Plaid public/link token found:"$'\n'"$HITS"

# Anthropic API keys.
HITS="$(search 'sk-ant-[A-Za-z0-9_-]{20,}')"
[[ -n "$HITS" ]] && report "Anthropic API key found:"$'\n'"$HITS"

# Supabase secret keys and service-role JWTs.
HITS="$(search 'sb_secret_[A-Za-z0-9_-]{16,}')"
[[ -n "$HITS" ]] && report "Supabase secret key found:"$'\n'"$HITS"

HITS="$(search 'service_role.{0,40}ey[A-Za-z0-9_-]{20,}\.')"
[[ -n "$HITS" ]] && report "Supabase service-role JWT found:"$'\n'"$HITS"

# Any assignment that puts a server secret into a Vite-exposed variable.
HITS="$(search 'VITE_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE|ANTHROPIC|PLAID_SECRET)')"
[[ -n "$HITS" ]] && report "Server secret exposed through a VITE_ variable:"$'\n'"$HITS"

# Committed environment files.
ENV_FILES="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)"
[[ -n "$ENV_FILES" ]] && report "Environment file is tracked in git:"$'\n'"$ENV_FILES"

# .env.example must contain names only, never values.
if git ls-files --error-unmatch .env.example >/dev/null 2>&1; then
  POPULATED="$(grep -nE '^[A-Z_]+=.+' .env.example || true)"
  [[ -n "$POPULATED" ]] && report ".env.example contains values, not just names:"$'\n'"$POPULATED"
fi

if [[ "$FAILED" -eq 0 ]]; then
  echo "==> no credentials found in tracked files"
else
  exit 1
fi
