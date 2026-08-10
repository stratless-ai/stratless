/**
 * THE DERIVED TUNE'S ANSWER KEY — fixture v2 (Solo V2, step 3).
 *
 * v1 of this fixture encoded the HAND-mint's six bundles and did exactly what an acceptance
 * test is for: it fired. Five embedding bases × two linkage rules all plateaued at 3/6 cores —
 * the hand bundles were the author's comprehension ("opposite directions of one dial"), which
 * no stored geometry carries. The record: builds/solo-v2-the-tune.md §step 3.
 *
 * v2 encodes the DERIVABLE truth (Sun's bless, 2026-08-10): seats are the record's own folds
 * plus its open patches; strays attach to the single nearest seat above ATTACH_FLOOR or stay
 * rows; register-anchored units are blocks. The expectations below are FROZEN from the first
 * calibrated live run on the reference archive (2026-08-10) and act as its regression net —
 * same store, same runtime, same tune, forever.
 *
 * Bigger bundles are the person's merge at the door, recorded and replayed — never the
 * compiler's opinion. The hand-mint survives as the artifact-form standard and as the first
 * recorded user-editorial session; it is no longer the structural oracle.
 */

export interface ExpectedUnit {
  kind: 'active' | 'triggered' | 'ambient';
  anchor: string;
  /** full membership, seats and attachments together, sorted */
  members: string[];
}

/** The reference archive's stage under the composition ladder: two patch-seated actives. */
export const EXPECTED_STAGE = 'stage-3';

/** The reference archive's derived tune, frozen from the calibrated run. The acceptance test
 *  skips unless the live store still carries exactly the row set this was frozen against —
 *  a rebuilt map is a new world, not a regression. */
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

export const EXPECTED_DERIVED_TUNE: { units: ExpectedUnit[]; leftovers: string[] } = {
  units: [
    { kind: 'active', anchor: 'ask-assistant-to-verify-remote-state', members: ['ask-assistant-to-verify-remote-state', 'ask-to-double-check-work', 'direct-commit-before-continuing'] },
    { kind: 'triggered', anchor: 'ask-how-to-set-up-integration', members: ['ask-for-guided-walkthrough', 'ask-how-to-set-up-integration'] },
    { kind: 'ambient', anchor: 'check-in-on-session-progress', members: ['ask-what-is-this', 'check-in-on-session-progress'] },
    { kind: 'active', anchor: 'give-minimal-continuation-signal', members: ['give-minimal-continuation-signal'] },
    { kind: 'ambient', anchor: 'give-terse-followup-directive', members: ['give-terse-followup-directive', 'insist-on-quality-standard', 'issue-single-word-git-command'] },
    { kind: 'triggered', anchor: 'open-strategic-discussion-topic', members: ['open-strategic-discussion-topic', 'probe-mechanism-with-uncertainty'] },
    { kind: 'triggered', anchor: 'propose-then-ask-for-plan', members: ['ask-for-clarification-or-recap', 'propose-then-ask-for-plan', 'request-walkthrough-with-explanation', 'state-progress-and-request-guidance'] },
    { kind: 'active', anchor: 'request-a-plan-before-implementing', members: ['ask-where-to-start-on-new-feature', 'request-a-plan-before-implementing', 'sequence-work-into-sessions'] },
    { kind: 'ambient', anchor: 'riff-on-product-direction', members: ['elaborate-on-strategic-rationale', 'riff-on-product-direction', 'think-out-loud-then-approve'] },
  ],
  // The actuator gate (2026-08-10) routes the two prediction-shaped folds' members here:
  // expectations are context the map carries, not instructions the tune ships.
  leftovers: [
    'question-a-design-choice',
    'question-current-setup-confusion',
    'question-scope-of-agentic-approach',
    'reflect-on-scope-drift',
    'report-observed-symptom',
  ],
};
