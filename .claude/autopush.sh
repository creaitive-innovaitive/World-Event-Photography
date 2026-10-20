#!/bin/sh
# Commit and push any changes at the end of a Claude turn.
cd "$(dirname "$0")/.." || exit 0
[ -n "$(git status --porcelain)" ] || exit 0
git add -A
git commit -qm "Update site

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
GH_TOKEN=$(gh auth token --user creaitive-innovaitive 2>/dev/null) git push -q origin main
