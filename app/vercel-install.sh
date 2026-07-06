#!/usr/bin/env bash
# Vercel install step. Lives in a script (not inline in vercel.json) because the
# git-token rewrite is longer than vercel.json's 256-char `installCommand` limit,
# which was silently failing every git-triggered deploy at schema validation.
#
# The private `ie-ai-rulebook` dependency is resolved in pnpm-lock.yaml as a
# git+ssh URL, but the Vercel build machine has no SSH key. Rewrite every
# github.com URL form to an HTTPS URL carrying IE_AGENT_RULES_TOKEN so the
# dependency installs over HTTPS with the token instead.
set -euo pipefail

if [ -n "${IE_AGENT_RULES_TOKEN:-}" ]; then
  base="https://${IE_AGENT_RULES_TOKEN}@github.com/"
  git config --global url."$base".insteadOf "git+ssh://git@github.com/"
  git config --global url."$base".insteadOf "ssh://git@github.com/"
  git config --global url."$base".insteadOf "git@github.com:"
  git config --global url."$base".insteadOf "https://github.com/"
else
  echo "warning: IE_AGENT_RULES_TOKEN is not set; private deps will fail to install" >&2
fi

pnpm install --frozen-lockfile
