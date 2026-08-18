import { useMemo, useState } from 'react';
import { api, fmt, seasonLabel, type Season, type SeasonBudget, type Team } from './api.js';

// Drafts the post to put on the team message board. The treasurer has the
// numbers in front of them on the Budget page and then retypes them into
// TeamSnap by hand, which is where transcription errors and "wait, when is that
// due again?" come from. These are the same figures the budget already shows.
//
// Deliberately editable rather than sent for you: teamledger has no way to post
// to anyone's message board, and every team's tone is different. Copy, tweak,
// paste.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Dates are plain 'YYYY-MM-DD' strings and must be formatted without ever
// becoming a Date. `new Date('2026-09-30')` parses as midnight UTC, so anyone
// west of Greenwich would read this message and see September 29th.
function prettyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

type Kind = 'announce' | 'first' | 'final' | 'nudge';

const LABELS: Record<Kind, string> = {
  announce: 'Dues are set',
  first: 'First payment reminder',
  final: 'Final payment due soon',
  nudge: 'Gentle nudge for stragglers',
};

// Names the categories this team actually has expenses in, so the message does
// not promise "tournaments" to a team that never enters one.
const CATEGORY_WORDS: Record<string, string> = {
  training: 'training',
  ref_fees: 'referee fees',
  tournaments: 'tournaments',
  jerseys: 'jerseys',
  misc: 'other team costs',
};

function coversList(budget: SeasonBudget): string {
  // Biggest first, so the sentence leads with where the money actually goes —
  // and "other team costs" is always last however large it is, because ending a
  // list on the vague one reads better than opening with it.
  const words = budget.expensesByCategory
    .filter((c) => c.amountCents > 0)
    .sort((a, b) => {
      if (a.category === 'misc') return 1;
      if (b.category === 'misc') return -1;
      return b.amountCents - a.amountCents;
    })
    .map((c) => CATEGORY_WORDS[c.category] ?? c.category);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function compose(kind: Kind, team: Team, season: Season, budget: SeasonBudget): string {
  const label = seasonLabel(season);
  const total = fmt(budget.quotedPerPlayerCents);
  const handle = (team.venmoHandle ?? '').trim() || '@your-venmo';
  const note = `Venmo ${handle} — please put your player's name in the note so I can match it up.`;

  const firstDue = prettyDate(season.firstPaymentDue);
  const finalDue = prettyDate(season.finalPaymentDue);
  const firstAmount = season.firstPaymentCents ?? 0;
  const split = firstAmount > 0 && firstAmount < budget.quotedPerPlayerCents;
  const remainder = fmt(Math.max(0, budget.quotedPerPlayerCents - firstAmount));

  // Credits and fundraising can cover the whole season, which makes the
  // per-player figure zero or negative. "Each player owes -$33.33" is not a
  // sentence to post anywhere, so say the useful thing instead.
  if (budget.quotedPerPlayerCents <= 0) {
    return [
      `Good news — ${label} is fully covered by credits, sponsorship and fundraising.`,
      '',
      'There is nothing to collect from players this season. I will let you know if that changes.',
      '',
      'Thanks!',
    ].join('\n');
  }

  switch (kind) {
    case 'announce': {
      const lines = [`Hi everyone — ${label} dues are set.`, ''];
      const covers = coversList(budget);
      lines.push(
        covers
          ? `Each player owes ${total} for the season. That covers ${covers}.`
          : `Each player owes ${total} for the season.`,
        '',
      );
      if (split) {
        lines.push('You can split it in two:');
        lines.push(`• ${fmt(firstAmount)}${firstDue ? ` by ${firstDue}` : ''}`);
        lines.push(`• ${remainder}${finalDue ? ` by ${finalDue}` : ' after that'}`);
      } else {
        lines.push(`Due${finalDue ? ` by ${finalDue}` : ' as soon as you can'}.`);
      }
      lines.push('', note, 'Cash or a check works too — just let me know.', '', 'Thanks!');
      return lines.join('\n');
    }

    case 'first':
      // With no instalment plan there is no "first" payment, and firstPaymentDue
      // may still hold a stale date — so fall back to the season total and the
      // final date rather than citing a deadline that means nothing.
      return [
        split
          ? `Quick reminder: the first ${label} payment of ${fmt(firstAmount)} is due${firstDue ? ` ${firstDue}` : ' shortly'}.`
          : `Quick reminder: ${label} dues of ${total} are due${finalDue ? ` ${finalDue}` : ' shortly'}.`,
        '',
        note,
        '',
        'Already sent it? Thank you — ignore this one.',
      ].join('\n');

    case 'final':
      return [
        `Heads up — the final ${label} payment of ${split ? remainder : total} is due${finalDue ? ` ${finalDue}` : ' shortly'}, about a week out.`,
        '',
        note,
        '',
        "If you're all paid up, you're set. Thanks!",
      ].join('\n');

    case 'nudge':
      return [
        `A few ${label} payments are still outstanding. If yours slipped your mind, no problem at all.`,
        '',
        note,
        '',
        'If you would rather work out a different schedule, just message me directly — happy to sort something out.',
      ].join('\n');
  }
}

export default function TeamMessage({
  team,
  season,
  budget,
  onTeamChange,
}: {
  team: Team;
  season: Season;
  budget: SeasonBudget;
  onTeamChange: () => void;
}) {
  // A season with no instalment plan has no first payment to remind anyone
  // about, so that option is not offered at all.
  const hasSplit =
    (season.firstPaymentCents ?? 0) > 0 &&
    (season.firstPaymentCents ?? 0) < budget.quotedPerPlayerCents;
  const nothingDue = budget.quotedPerPlayerCents <= 0;
  const kinds = nothingDue
    ? (['announce'] as Kind[])
    : (Object.keys(LABELS) as Kind[]).filter((k) => k !== 'first' || hasSplit);

  const [kind, setKind] = useState<Kind>('announce');
  const [handle, setHandle] = useState(team.venmoHandle ?? '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Regenerated whenever the numbers or the chosen message change; edits are
  // kept in `draft` so tweaking the wording is not lost on a re-render.
  const generated = useMemo(
    () => compose(kind, { ...team, venmoHandle: handle || null }, season, budget),
    [kind, team, handle, season, budget],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? generated;

  const saveHandle = () => {
    setSaving(true);
    setError(null);
    api
      .patch(`/teams/${team.id}`, { venmoHandle: handle.trim() || null })
      .then(() => onTeamChange())
      .catch((err: Error) => setError(err.message))
      .finally(() => setSaving(false));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not reach the clipboard — select the text and copy it manually.');
    }
  };

  return (
    <div className="panel">
      {error && <div className="error">{error}</div>}

      <p className="notice" style={{ marginTop: 0 }}>
        A ready-made post for the team message board, using the figures above. Copy it, change
        anything you like, and paste it wherever your team talks.
      </p>

      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="venmo">Your Venmo handle</label>
          <input
            id="venmo"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              setDraft(null);
            }}
            onBlur={saveHandle}
            placeholder="@riverside-treasurer"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="kind">Message</label>
          <select
            id="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setDraft(null);
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {nothingDue && (
        <p className="notice">
          Credits cover the season, so there is nothing to collect — the only message that makes
          sense is the announcement. If that looks wrong, check your expenses are entered.
        </p>
      )}

      <textarea
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        rows={text.split('\n').length + 1}
        style={{ width: '100%', fontFamily: 'inherit', lineHeight: 1.5 }}
        aria-label="Message to post"
      />

      <div className="section-head" style={{ margin: '10px 0 0' }}>
        <button className="primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy message'}
        </button>
        {draft !== null && (
          <button className="link" onClick={() => setDraft(null)}>
            Reset to generated
          </button>
        )}
        {saving && <span className="muted">saving handle…</span>}
      </div>
    </div>
  );
}
