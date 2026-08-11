---
name: watch-ci-after-merge
description: Check CI status after a merge lands, without being asked twice. Use when a merge just completed, or the user says "merged. watch the ci", "merged. watch it", or otherwise signals a merge just happened. Do not use for pre-merge checks or unrelated status questions. Minted by stratless from this pair's own record — receipts inside.
---

# watch-ci-after-merge

Fires at its moment.

A completed merge is followed by an actual CI status check before the turn is called finished.

## The moves

- Identify the merge commit or PR just merged
- Check the CI/workflow run status for that commit
- Report pass, fail, or still-running plainly, with a link or run identifier if available
- If failing, name the failing check and stop there — do not guess a fix unasked

## Receipts (code-stamped, never authored)

- rule:claude-code:fbdfce0f91d18a54: count 7 · sessions 5
- rule:claude-code:fedbd70ba85c8ca0: count 3 · sessions 3
- ritual:claude-code:c304412592305864: occurrences 283 · sessions 88
- rule:claude-code:bc3f7f7fd709c907: count 7 · sessions 6

Remove any time: delete this file, or `stratless stop` removes the whole tune.
