/**
 * THE RATE CARD — the cold quote.
 *
 * stopwatch.ts MEASURES and refuses to guess: on a fresh machine it has no runs, so it yields no ETA
 * (stageRates → {}, etaMs → undefined). But the door has to price the build BEFORE the first run
 * exists. That one number comes from here — a shipped constant, measured once on a real archive, not
 * a live reading. The instant real stages run, the stopwatch's measured ETA takes over; this is only
 * the number shown at minute zero.
 *
 * PROVENANCE: the discovery pipeline scored 4,950 moments for ~$8.73 in ~15 min on the build
 * machine's own archive (2026-07-21) — the one paid measurement we own. Everything here is arithmetic
 * on it. The single end-of-build confirmation run is what replaces these constants; when it lands,
 * update REFERENCE below and nothing else.
 *
 * The dollars are the API-equivalent (a subscription spends quota, not cash), same convention as the
 * receipt in loop.ts — quoted, never hidden.
 */

/** The one paid measurement — the 0.4.0 confirmation run (2026-07-23): 5,141 moments scored for ~$14.63
 *  in ~33 min, on an archive of 5,120 submitted messages (49 categories, 4 rounds). Update all four here
 *  from a fresh confirmation run. NOTE: the earlier 07-21 prototype quoted 4,950 / $8.73 / 15 min — the
 *  real build ran ~61% costlier and ~2× longer, mostly because a large category set fattens every assign
 *  prompt. If category minting or the haiku/sonnet call pairing is tightened later, re-measure and lower. */
export const REFERENCE = {
  moments: 5141,
  usd: 14.63,
  minutes: 33,
  messages: 5120,
} as const;

const USD_PER_MOMENT = REFERENCE.usd / REFERENCE.moments; // ≈ $0.00176
const MIN_PER_MOMENT = REFERENCE.minutes / REFERENCE.moments; // ≈ 0.0030 min
/** The pile (moments) runs above submitted messages (~1.11× on the reference archive). The door can
 *  only cheaply count messages before the pile is built, so it scales UP to an estimated moment count:
 *  quoting from messages directly would UNDER-state the per-moment spend, the one direction a cost
 *  quote must never err (underquoting our own product is the meter catching us lying). */
const MOMENTS_PER_MESSAGE = REFERENCE.moments / REFERENCE.messages;

export interface BuildEstimate {
  /** the pile size the quote was computed for */
  moments: number;
  /** API-equivalent dollars */
  usd: number;
  /** wall-clock minutes */
  minutes: number;
}

/**
 * Quote a cold build of `pileCount` moments from the shipped rate card. Linear in the pile: assign is
 * the dominant cost and it is ~flat per moment (batched 200/call, thinking capped to 0). A negative
 * or fractional count is floored to a sane non-negative integer.
 */
export function estimateBuild(pileCount: number): BuildEstimate {
  const moments = Number.isFinite(pileCount) ? Math.max(0, Math.floor(pileCount)) : 0;
  return {
    moments,
    usd: moments * USD_PER_MOMENT,
    minutes: moments * MIN_PER_MOMENT,
  };
}

/**
 * Quote a cold build from a submitted-MESSAGE count — what the door has before the pile is built —
 * scaled up to the moment count the build will actually price. Prefer estimateBuild(pileLength) when
 * the pile exists; this is the pre-pile fallback, and it rounds toward the real (higher) spend.
 */
export function estimateFromMessages(messageCount: number): BuildEstimate {
  const msgs = Number.isFinite(messageCount) ? Math.max(0, messageCount) : 0;
  return estimateBuild(Math.round(msgs * MOMENTS_PER_MESSAGE));
}

/**
 * A one-line human quote: "~4,950 moments · ~$8.73 · ~15 min". A sub-cent build still reads as a
 * spend ("< $0.01", never "$0.00"); a sub-minute build reads "< 1 min".
 */
export function estimateLine(e: BuildEstimate): string {
  const dollars = e.usd > 0 && e.usd < 0.005 ? '< $0.01' : `~$${e.usd.toFixed(2)}`;
  const mins = e.minutes > 0 && e.minutes < 1 ? '< 1 min' : `~${Math.round(e.minutes)} min`;
  return `~${e.moments.toLocaleString()} moments · ${dollars} · ${mins}`;
}
