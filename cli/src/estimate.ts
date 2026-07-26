/**
 * THE RATE CARD — the cold quote.
 *
 * stopwatch.ts MEASURES and refuses to guess: on a fresh machine it has no runs, so it yields no ETA
 * (stageRates → {}, etaMs → undefined). But the door has to price the build BEFORE the first run
 * exists. That one number comes from here — a shipped constant, measured once on a real archive, not
 * a live reading. The instant real stages run, the stopwatch's measured ETA takes over; this is only
 * the number shown at minute zero.
 *
 * PROVENANCE (historical, superseded by REFERENCE below): the discovery pipeline scored 4,950 moments for ~$8.73 in ~15 min on the build
 * machine's own archive (2026-07-21) — the one paid measurement we own. Everything here is arithmetic
 * on it. The single end-of-build confirmation run is what replaces these constants; when it lands,
 * update REFERENCE below and nothing else.
 *
 * The dollars are the API-equivalent (a subscription spends quota, not cash), same convention as the
 * receipt in loop.ts — quoted, never hidden.
 */

/**
 * The one paid measurement — the v3 engine's first real cold build (2026-07-26): **5,647 moments for
 * $0.25 in 3.7 minutes**, on an archive of ~5,550 submitted messages. Update all four here from a
 * fresh confirmation run.
 *
 * WHAT CHANGED, and why the numbers moved by two orders of magnitude. The previous reference was
 * $13.27 / 33 minutes, and 71% of it was cache-creation the borrowed CLI writes and never reads back
 * — a tax that scaled with pile tokens and that batching could not touch. v3 removed the stage that
 * paid it: `assign` asked a model "does this moment fit this category?" ~190,000 times per build, and
 * a local embedding model now answers the same question with arithmetic, on this machine, for
 * nothing. **The whole remaining bill is ONE naming call plus the profile write.**
 *
 * Measured breakdown of that run: build (shape + fingerprint + cluster + name) 192.8s, write 15.0s.
 * The fingerprinting — the longest stretch — costs $0 and never leaves the machine.
 *
 * `messages` is carried at the previous run's moments-per-message ratio (~1.02) rather than
 * re-measured: it describes how a transcript becomes a pile, which the engine change did not touch.
 */
export const REFERENCE = {
  moments: 5647,
  usd: 0.25,
  minutes: 3.7,
  messages: 5550,
} as const;

const USD_PER_MOMENT = REFERENCE.usd / REFERENCE.moments; // ≈ $0.000044
const MIN_PER_MOMENT = REFERENCE.minutes / REFERENCE.moments; // ≈ 0.00066 min
/** The pile (moments) runs above submitted messages (~1.02× on the reference archive). The door can
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
 * Quote a cold build of `pileCount` moments from the shipped rate card.
 *
 * LINEAR IN THE PILE, and less exactly so than it used to be. The cost is now one naming call plus
 * the profile write, and neither scales cleanly with pile size — the naming call scales with the
 * NUMBER OF PILES (derived, 8-30) rather than the number of moments. Wall-clock does scale with the
 * pile, because fingerprinting is per-moment. Linear stays the honest approximation for a door that
 * must quote before anything has run, and it errs high on large piles, which is the safe direction.
 * A negative or fractional count is floored to a sane non-negative integer.
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
 * A one-line human quote: "~5,647 moments · ~$0.25 · ~4 min". A sub-cent build still reads as a
 * spend ("< $0.01", never "$0.00"); a sub-minute build reads "< 1 min".
 */
export function estimateLine(e: BuildEstimate): string {
  const dollars = e.usd > 0 && e.usd < 0.005 ? '< $0.01' : `~$${e.usd.toFixed(2)}`;
  const mins = e.minutes > 0 && e.minutes < 1 ? '< 1 min' : `~${Math.round(e.minutes)} min`;
  return `~${e.moments.toLocaleString()} moments · ${dollars} · ${mins}`;
}
