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

  // FULL (the `mirror` read, not the init door's tight teaser): everything below the anchor that
  // is already computed for the free read — the door keeps its four-row teaser untouched.
  if (opts.full) {
    if (m.scale.medianPerActiveDay) {
      rows.push({ label: 'a median day', value: `${m.scale.medianPerActiveDay} messages` });
    }
    if (m.scale.firstMessage && m.scale.lastMessage) {
      rows.push({
        label: 'span',
        value: `${m.scale.firstMessage.slice(0, 10)} → ${m.scale.lastMessage.slice(0, 10)} · longest streak ${m.scale.longestStreak} day${m.scale.longestStreak === 1 ? '' : 's'}`,
      });
    }
    rows.push(writingRow(m));
    // The one row that quotes the person instead of counting them. Terminal only — the card
    // never draws `writing.repeated` (see renderCard).
    if (m.writing.repeated.length) {
      rows.push({
        label: 'what you keep typing',
        value: m.writing.repeated
          .slice(0, 3)
          .map((r) => `"${r.text}" ${r.count}×`)
          .join(' · '),
      });
    }
    if (m.writing.images) rows.push({ label: 'screenshots sent', value: m.writing.images.toLocaleString() });
  }

  // The two friction numbers, reported separately (never summed).
  rows.push(...frictionRows(m, messages));

  if (opts.full) {
    if (m.friction.daysWithAny) {
      rows.push({ label: 'friction days', value: `${m.friction.daysWithAny} of ${m.scale.activeDays} active days` });
    }
    // mirror.ts:69 promises the excluded interrupts are "shown, never silently dropped" — this row
    // is where that promise is kept.
    if (m.friction.permissionStops || m.friction.systemBlocks) {
      rows.push({
        label: 'not counted against you',
        value: `${m.friction.permissionStops} permission stops · ${m.friction.systemBlocks} system blocks`,
      });
    }
  }

  // Busiest repo, by messages typed in it — the full read carries the spread beside it.
  const topRepo = m.context.repos.reduce<{ root: string; messages: number } | undefined>(
    (best, r) => (!best || r.messages > best.messages ? r : best),
    undefined,
  );
  if (topRepo) {
    const spread =
      opts.full && m.context.repos.length > 1 && m.context.branchNames
        ? ` · across ${m.context.repos.length} repos · ${m.context.branchNames} branches`
        : '';
    rows.push({ label: 'busiest repo', value: basename(topRepo.root) + spread });
  }

  // Tools: the full read shows the scale of delegation and the mix; the door keeps the single
  // top tool it has always shown.
  if (opts.full && m.work.toolCalls) {
    const mix = m.work.toolMix
      .slice(0, 2)
      .map((t) => `${t.name} ${Math.round(100 * t.share)}%`)
      .join(' · ');
    rows.push({ label: 'tools it ran for you', value: `${m.work.toolCalls.toLocaleString()} calls · ${mix}` });
  } else {
    const tool = topToolRow(m);
    if (tool) rows.push(tool);
  }

  return rows;
}

/**
 * THE SHAREABLE CARD — the same free read, curated to the UNIVERSAL, name-safe surface so it is safe
 * to screenshot and forward (the viral unit the launch carries). The rule: the card draws ONLY from
 * aggregate number fields. It omits `busiest repo` (a repo basename can be a client or project name),
 * never touches `topics` (session titles), and never touches `writing.repeated` — the Mirror's one
 * text-carrying field, which exists for the person's own terminal alone. Any future field that
 * carries text is terminal-only by default; the card must opt nothing in without this comment
 * changing. Neutral labels only: the post brands the number ("AI Brain Fry" etc.), the tool never
 * marries a noun that might not stick.
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

  // Deliberately omitted: `busiest repo` (a repo basename can name a client/project), `topics`
  // (session titles), and `writing.repeated` (the person's own words). Universal numbers only —
  // nothing here can carry a name or a quote.
  return rows;
}
