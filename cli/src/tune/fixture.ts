/**
 * MEASURE'S ANSWER KEY — ground truths hand-verified against the reference archive BEFORE the
 * detectors were built (2026-08-10 probes); the miners must find them or the miners are wrong.
 *
 * FIXTURE_ROWS freezes the row set of the live claude-code store the truths were verified
 * against: the acceptance test skips unless the store still carries exactly this set — a rebuilt
 * map is a new world, not a regression. Re-freeze from a fresh calibrated run when the map moves.
 */

/** The reference archive's row set at freeze time (2026-08-10). */
export const FIXTURE_ROWS = [
  'ask-assistant-to-verify-remote-state', 'ask-for-clarification-or-recap', 'ask-for-guided-walkthrough',
  'ask-how-to-set-up-integration', 'ask-to-double-check-work', 'ask-what-is-this',
  'ask-where-to-start-on-new-feature', 'check-in-on-session-progress', 'direct-commit-before-continuing',
  'elaborate-on-strategic-rationale', 'give-minimal-continuation-signal', 'give-terse-followup-directive',
  'insist-on-quality-standard', 'issue-single-word-git-command', 'open-strategic-discussion-topic',
  'probe-mechanism-with-uncertainty', 'propose-then-ask-for-plan', 'question-a-design-choice',
  'question-current-setup-confusion', 'question-scope-of-agentic-approach', 'reflect-on-scope-drift',
  'report-observed-symptom', 'request-a-plan-before-implementing', 'request-walkthrough-with-explanation',
  'riff-on-product-direction', 'sequence-work-into-sessions', 'share-external-reference-for-reaction',
  'state-progress-and-request-guidance', 'think-out-loud-then-approve', 'vent-about-motivation-while-reasoning',
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
