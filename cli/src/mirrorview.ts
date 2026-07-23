/**
 * MIRRORVIEW — the display layer for the free mirror.
 *
 * mirror.ts computes and deliberately does not print (mirror.ts:21). This turns a `Mirror` into a
 * handful of honest, recognisable lines for the door — the free read a user sees BEFORE any spend,
 * the thing that carries every user who defers the paid build. It stays pure (no colour, no TTY, no
 * I/O) so it is trivially testable; index.ts owns the colour and the header.
 *
 * WHY THESE LINES. The two friction numbers are the scoreboard, and they are reported SEPARATELY,
 * never summed — course corrections per 100 messages (the KPI, ~2.68 on the build archive) and tool
 * declines as a raw count (26). Summing them was the exact 2026-07-19 bug; the mirror keeps a summed
 * `perHundred` field, and this view does not use it. The scale and context lines around them exist so
 * the read feels like a person, not a metric.
 */
import type { Mirror } from './mirror.js';

export interface MirrorRow {
  label: string;
  value: string;
}

/** Last path segment of an absolute repo root — a person recognises "stratless-mono", not the path. */
function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/**
 * A few honest rows for the free read. Empty when there is no history yet (no submitted messages) —
 * the caller shows the "talk to your assistant first" path instead. Any row whose data is missing is
 * skipped rather than shown as a zero. `full` adds the span and writing fingerprint for the `stats`
 * dashboard; the door leaves them off to stay a tight teaser.
 */
export function renderMirror(m: Mirror, opts: { full?: boolean } = {}): MirrorRow[] {
  const messages = m.scale.messages;
  if (!messages) return [];

  const rows: MirrorRow[] = [];

  rows.push({
    label: 'you and your assistant',
    value: `${messages.toLocaleString()} messages · ${m.scale.activeDays} active day${m.scale.activeDays === 1 ? '' : 's'}`,
  });

  // FULL (the `stats` dashboard, not the door's tight teaser): the span and the writing fingerprint.
  // Both are already computed for the free read — the door just keeps them tucked away.
  if (opts.full) {
    if (m.scale.firstMessage && m.scale.lastMessage) {
      rows.push({
        label: 'span',
        value: `${m.scale.firstMessage.slice(0, 10)} → ${m.scale.lastMessage.slice(0, 10)} · longest streak ${m.scale.longestStreak} day${m.scale.longestStreak === 1 ? '' : 's'}`,
      });
    }
    rows.push({
      label: 'how you write',
      value: `median ${m.writing.median} words · ${Math.round(100 * m.writing.terseShare)}% four words or fewer · ${Math.round(100 * m.writing.questionShare)}% questions`,
    });
  }

  // The KPI: course corrections per 100 submitted messages. Reported alone — NOT summed with declines.
  const per100 = (100 * m.friction.courseCorrections) / messages;
  rows.push({ label: 'course corrections', value: `${per100.toFixed(2)} / 100 messages` });

  // Tool declines: a raw count, the second number, deliberately kept separate from the rate.
  rows.push({ label: 'tool declines', value: m.friction.toolDeclines.toLocaleString() });

  // Busiest repo, by messages typed in it.
  const topRepo = m.context.repos.reduce<{ root: string; messages: number } | undefined>(
    (best, r) => (!best || r.messages > best.messages ? r : best),
    undefined,
  );
  if (topRepo) rows.push({ label: 'busiest repo', value: basename(topRepo.root) });

  // Most-used tool, as a share of all tool calls (computed here, not read from `share`, to be sure of
  // the unit).
  const topTool = m.work.toolMix.reduce<{ name: string; calls: number } | undefined>(
    (best, t) => (!best || t.calls > best.calls ? t : best),
    undefined,
  );
  if (topTool && m.work.toolCalls) {
    const pct = Math.round((100 * topTool.calls) / m.work.toolCalls);
    rows.push({ label: 'most-used tool', value: `${topTool.name} (${pct}%)` });
  }

  return rows;
}
