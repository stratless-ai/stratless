/**
 * MEASURE'S ANSWER KEY — ground truths hand-verified against the reference archive BEFORE the
 * detectors were built (2026-08-10 probes); the miners must find them or the miners are wrong.
 *
 * FIXTURE_ROWS freezes the row set of the live claude-code store the truths were verified
 * against: the acceptance test skips unless the store still carries exactly this set — a rebuilt
 * map is a new world, not a regression. Re-freeze from a fresh calibrated run when the map moves.
 */

/** The reference archive's row set at freeze time — re-frozen 2026-08-11 after the
 *  first `update --rebuild` re-derived the map from scratch. */
export const FIXTURE_ROWS = [
  'ask-assistant-to-verify-state',
  'ask-for-plain-explanation',
  'ask-for-step-by-step-clicks',
  'confirm-transition-to-next-phase',
  'defer-commit-to-later-session',
  'flag-a-signal-then-greenlight',
  'gate-implementation-behind-understanding',
  'issue-bare-git-action',
  'issue-cleanup-batch-directive',
  'issue-go-ahead-shorthand',
  'issue-run-and-scope-command',
  'issue-terse-one-word-directive',
  'model-cost-and-design-tradeoffs',
  'narrate-progress-while-deciding',
  'paste-link-or-error-for-triage',
  'paste-terminal-output-for-diagnosis',
  'propose-numbered-plan-items',
  'pushback-question-with-detail',
  'question-a-past-decision',
  'question-whether-to-pause-a-track',
  'reason-through-positioning-out-loud',
  'report-setup-done-ask-next-step',
  'request-a-plan-before-acting',
  'request-guided-walkthrough',
  'request-plan-then-fix',
  'request-walkthrough-with-check-in',
  'resume-and-ask-orientation',
  'sequence-the-work',
  'share-screenshot-for-reaction',
  'vent-then-shrug-off',
].sort();

/** MEASURE's ground truths — episodes verified by hand against the reference archive
 *  (2026-08-10 probes) BEFORE the detectors were built; the miners must find them or the
 *  miners are wrong. Same skip-when-absent discipline as the derivation fixture. */
export const MEASURE_GROUND_TRUTHS = {
  /** the commit ritual, from raw Bash inputs */
  ritualTokens: ['git add', 'git commit', 'git log'],
  /** the June jina episode — hand-verified costliest correction arc */
  lessonQuote: 'topped up jina',
  /** the standing demand no earlier derivation ever surfaced */
  rulePhrase: 'merged. watch the ci',
  /** fast approvals exist in quantity (floor set below the hand-verified count) */
  winsAtLeast: 15,
  /** the July pivot vocabulary, verified against war-room history */
  arrivalTerm: 'human.md',
} as const;
