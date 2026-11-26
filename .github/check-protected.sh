#!/usr/bin/env bash
# Reads changed file paths, one per line, on stdin. Prints those under a frozen path in
# .github/protected-paths.txt and exits 1 if there are any. A listed path ending in / covers
# everything under it; any other listed path must match exactly.
set -euo pipefail
list="$(dirname "$0")/protected-paths.txt"
hits=$(awk 'NR == FNR { sub(/[ \t\r]+$/, ""); if ($0 !~ /^#/ && NF) frozen[$0] = 1; next }
  { for (p in frozen) if ($0 == p || (substr(p, length(p)) == "/" && index($0, p) == 1)) { print; break } }' \
  "$list" - | sort -u)
if [ -n "$hits" ]; then
  echo "This pull request changes files that only the maintainer changes (see CONTRIBUTING.md):"
  echo "$hits" | sed 's/^/  /'
  exit 1
fi
echo "No frozen path is changed."
