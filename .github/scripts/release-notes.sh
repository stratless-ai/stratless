#!/usr/bin/env bash
#
# THE RELEASE TITLE AND BODY, derived from cli/CHANGELOG.md. One implementation, two callers.
#
# It lives in a file rather than inline in publish.yml because publish.yml runs ONLY on a tag push or
# a manual dispatch — so for its whole life nothing tested it until the one run that cannot be taken
# back. That is how the title parser shipped broken for nine releases (#61): it split the heading on
# an em dash after the changelog had moved to "·", found nothing, fell through to a bare
# "stratless x.y.z", and never once went red. A poorer title is not a failure, so nothing failed.
#
# Now publish.yml calls this, and cli.yml's `release gates` job calls it on every PR and asserts on
# what it returns. The two can no longer drift, because there is only one of them.
#
#   release-notes.sh --title <version>   → "stratless 0.9.0 · reads Claude Code and Codex today"
#   release-notes.sh --notes <version>   → the changelog section for that version
#
# Exits non-zero with a message when the changelog has no section for the version. That is the
# intended behaviour in both callers: at release time it stops a note-less release, and at PR time it
# says the version bump arrived without its changelog entry.

set -euo pipefail

mode="${1:-}"
v="${2:-}"
changelog="${CHANGELOG:-cli/CHANGELOG.md}"

if [ -z "$mode" ] || [ -z "$v" ]; then
  echo "usage: release-notes.sh --title|--notes <version>" >&2
  exit 2
fi

heading="$(grep -m1 -F "## [$v]" "$changelog" || true)"
if [ -z "$heading" ]; then
  echo "::error::$changelog has no section for $v" >&2
  exit 1
fi

case "$mode" in
  --notes)
    # Everything between this version's heading and the next one.
    notes="$(awk -v v="$v" '
      $0 ~ "^## \\[" v "\\]" { grab = 1; next }
      grab && /^## \[/ { exit }
      grab { print }
    ' "$changelog")"
    if [ -z "${notes//[[:space:]]/}" ]; then
      echo "::error::$changelog section for $v is empty" >&2
      exit 1
    fi
    printf '%s\n' "$notes"
    ;;

  --title)
    # SEPARATOR-AGNOSTIC, like the changelog date gate and for the same reason: the point is the
    # tagline existing, not the punctuation around it. Strip the version, then the date, then
    # whichever separator follows. What remains is the tagline — and nothing remaining is a real
    # answer, not an error (0.1.0 through 0.3.2 never had one).
    rest="${heading#*]}"                                          # " · 2026-01-01 · the tagline"
    rest="${rest#*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]}"    # " · the tagline"
    rest="$(sed -E 's/^[[:space:]]*(—|·|-)[[:space:]]*//' <<<"$rest")"
    if [ -n "$rest" ]; then
      printf 'stratless %s · %s\n' "$v" "$rest"
    else
      printf 'stratless %s\n' "$v"
    fi
    ;;

  *)
    echo "usage: release-notes.sh --title|--notes <version>" >&2
    exit 2
    ;;
esac
