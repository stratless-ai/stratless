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

// ── Shared row builders. Both the full read (`renderMirror`) and the shareable card (`renderCard`)
// draw from these, so the two views can never drift — most importantly the friction rule below.

/** The writing fingerprint: median length, how terse, how many questions. */
function writingRow(m: Mirror): MirrorRow {
  return {
    label: 'how you write',
    value: `median ${m.writing.median} words · ${Math.round(100 * m.writing.terseShare)}% four words or fewer · ${Math.round(100 * m.writing.questionShare)}% questions`,
  };
}

/**
 * The two friction numbers, ALWAYS separate — course corrections per 100 messages (the KPI) and tool
 * declines as a raw count. Summing them was the exact 2026-07-19 bug; the mirror keeps a summed
 * `friction.perHundred` and this file deliberately never reads it. Keeping the pair in one place is
 * what stops the bug from creeping back into just one of the two views.
 */
function frictionRows(m: Mirror, messages: number): MirrorRow[] {
  const per100 = (100 * m.friction.courseCorrections) / messages;
  return [
    { label: 'course corrections', value: `${per100.toFixed(2)} / 100 messages` },
    { label: 'tool declines', value: m.friction.toolDeclines.toLocaleString() },
  ];
}

/** Most-used tool as a share of all tool calls — a tool name (Bash/Edit), never a repo or project. */
function topToolRow(m: Mirror): MirrorRow | undefined {
  const topTool = m.work.toolMix.reduce<{ name: string; calls: number } | undefined>(
    (best, t) => (!best || t.calls > best.calls ? t : best),
    undefined,
  );
  if (!topTool || !m.work.toolCalls) return undefined;
  const pct = Math.round((100 * topTool.calls) / m.work.toolCalls);
  return { label: 'most-used tool', value: `${topTool.name} (${pct}%)` };
}

/**
 * A few honest rows for the free read. Empty when there is no history yet (no submitted messages) —
 * the caller shows the "talk to your assistant first" path instead. Any row whose data is missing is
 * skipped rather than shown as a zero. `full` adds the span and writing fingerprint for the `mirror`
 * read; the init door leaves them off to stay a tight teaser.
 */
export function renderMirror(m: Mirror, opts: { full?: boolean } = {}): MirrorRow[] {
  const messages = m.scale.messages;
  if (!messages) return [];

  const rows: MirrorRow[] = [];

  rows.push({
    label: 'you and your assistant',
    value: `${messages.toLocaleString()} messages · ${m.scale.activeDays} active day${m.scale.activeDays === 1 ? '' : 's'}`,
  });

  // FULL (the `mirror` read, not the init door's tight teaser): the span and the writing fingerprint.
  // Both are already computed for the free read — the door just keeps them tucked away.
  if (opts.full) {
    if (m.scale.firstMessage && m.scale.lastMessage) {
      rows.push({
        label: 'span',
        value: `${m.scale.firstMessage.slice(0, 10)} → ${m.scale.lastMessage.slice(0, 10)} · longest streak ${m.scale.longestStreak} day${m.scale.longestStreak === 1 ? '' : 's'}`,
      });
    }
    rows.push(writingRow(m));
  }

  // The two friction numbers, reported separately (never summed).
  rows.push(...frictionRows(m, messages));

  // Busiest repo, by messages typed in it.
  const topRepo = m.context.repos.reduce<{ root: string; messages: number } | undefined>(
    (best, r) => (!best || r.messages > best.messages ? r : best),
    undefined,
  );
  if (topRepo) rows.push({ label: 'busiest repo', value: basename(topRepo.root) });

  // Most-used tool, as a share of all tool calls.
  const tool = topToolRow(m);
  if (tool) rows.push(tool);

  return rows;
}

/**
 * THE SHAREABLE CARD — the same free read, curated to the UNIVERSAL, name-safe surface so it is safe
 * to screenshot and forward (the viral unit the launch carries). It is `renderMirror` minus the one
 * identifying row — `busiest repo`, whose value is a repo basename that can be a client or project
 * name — and it never touches `topics` (session titles) either. Everything left is an aggregate; the
 * mirror holds no raw message text, so the card leaks nothing. Neutral labels only: the post brands
 * the number ("AI Brain Fry" etc.), the tool never marries a noun that might not stick.
 */
export function renderCard(m: Mirror): MirrorRow[] {
  const messages = m.scale.messages;
  if (!messages) return [];

  const rows: MirrorRow[] = [
    {
      label: 'activity',
      value: `${messages.toLocaleString()} messages · ${m.scale.activeDays} active day${m.scale.activeDays === 1 ? '' : 's'} · longest streak ${m.scale.longestStreak} day${m.scale.longestStreak === 1 ? '' : 's'}`,
    },
    writingRow(m),
    ...frictionRows(m, messages),
  ];

  const tool = topToolRow(m);
  if (tool) rows.push(tool);

  // Deliberately omitted: `busiest repo` (a repo basename can name a client/project) and `topics`
  // (session titles). Universal numbers only — nothing here can carry a name.
  return rows;
}
