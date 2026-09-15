import { useState, type ReactNode } from 'react';
import { api, fmt, parseMoney } from './api.js';

// Shared page furniture. Every screen in this app is the same shape — a few
// sections, each a table plus a form to add a row — and having that shape in
// one place is what stops the pages drifting apart as they grow.

// A section heading with its primary action on the same line, so the action is
// visible before any of the rows beneath it.
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 style={{ margin: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

// A section whose form is hidden until asked for. The form was previously
// always on screen, below its table, which on any page with real data pushed it
// out of sight and made it look like the feature was missing.
export function AddSection({
  title,
  addLabel,
  form,
  children,
}: {
  title: string;
  addLabel: string;
  // Rendered only while open; receives a callback to close itself after a
  // successful save.
  form: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionHead title={title}>
        <button className={open ? '' : 'primary'} onClick={() => setOpen((o) => !o)}>
          {open ? 'Cancel' : addLabel}
        </button>
      </SectionHead>
      <div className="panel table-wrap">
        {open && form(() => setOpen(false))}
        {children}
      </div>
    </>
  );
}

// Folded-away section. Native <details> so it works without JavaScript and
// keyboard/screen-reader behaviour comes for free.
export function Collapsible({
  title,
  hint,
  open,
  children,
}: {
  title: string;
  hint?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        {title}
        {hint ? <span> {hint}</span> : null}
      </summary>
      {children}
    </details>
  );
}

// Read-only until you ask to change it. Used for records that are set up once
// and then mostly looked at — a player's name and contact details, the bank
// account's starting balance — where an always-live form invites accidental
// edits and adds noise to every visit.
export function EditableCard({
  summary,
  form,
}: {
  summary: ReactNode;
  form: (close: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="panel">
      <div className="section-head" style={{ margin: '0 0 10px' }}>
        <div style={{ minWidth: 0 }}>{summary}</div>
        <button onClick={() => setEditing((e) => !e)}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      {editing && form(() => setEditing(false))}
    </div>
  );
}

export type PayableLine = {
  id: number;
  paidOn: string;
  amountCents: number;
  method: string;
  note: string | null;
};

// One payee's row in a "who do I owe" table — a trainer paid in a lump sum, or
// a ref-fee rule paid per game. Bank and Dashboard both use this so paying a
// trainer and paying a ref look and behave the same way, and so a fix to one
// applies to both instead of two hand-rolled forms drifting apart.
//
// `compact` drops the session-count/forecast columns for the Dashboard's
// tighter table, where the only question is "who's owed and can I pay them
// now" — the season-long detail belongs on the Bank page.
export function PayableRow({
  label,
  completedSessions,
  billedSessions,
  earnedToDateCents,
  paidCents,
  owedCents,
  forecastCents,
  payments,
  payUrl,
  deletePrefix,
  extraFields,
  onChanged,
  compact,
}: {
  label: string;
  completedSessions: number;
  billedSessions: number;
  earnedToDateCents: number;
  paidCents: number;
  owedCents: number;
  forecastCents: number;
  payments: PayableLine[];
  payUrl: string;
  deletePrefix: string;
  // Merged into the POST body — e.g. { trainerId } or { ruleId } — so this
  // component does not need to know which kind of payee it is paying.
  extraFields: Record<string, unknown>;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('venmo');
  const [error, setError] = useState<string | null>(null);

  const cols = compact ? 3 : 7;

  const pay = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount');
    setError(null);
    api
      .post(payUrl, { paidOn, amountCents: cents, method, ...extraFields })
      .then(() => {
        setAmount('');
        setOpen(false);
        onChanged();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <>
      <tr>
        <td>{label}</td>
        {!compact && (
          <td className="num muted hide-sm">
            {completedSessions}
            <span className="derived"> of {billedSessions}</span>
          </td>
        )}
        {!compact && <td className="num hide-sm">{fmt(earnedToDateCents)}</td>}
        {!compact && <td className="num hide-sm">{fmt(paidCents)}</td>}
        <td className={`num ${owedCents > 0 ? 'owes' : owedCents < 0 ? 'overpaid' : 'settled'}`}>
          {fmt(owedCents)}
        </td>
        {!compact && <td className="num muted hide-sm">{fmt(forecastCents)}</td>}
        <td className="num">
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'Cancel' : 'Pay'}
          </button>
        </td>
      </tr>
      {payments.length > 0 && (
        <tr>
          <td />
          <td colSpan={cols - 1}>
            {payments.map((p) => (
              <div key={p.id} className="muted" style={{ fontSize: 13 }}>
                {p.paidOn} — {fmt(p.amountCents)} ({p.method})
                <button
                  className="link danger"
                  onClick={() =>
                    confirm('Delete this payment and its bank line?') &&
                    api.del(`${deletePrefix}/${p.id}`).then(onChanged)
                  }
                >
                  remove
                </button>
              </div>
            ))}
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={cols}>
            <form className="form-row" onSubmit={pay}>
              <div className="field">
                <label>Date</label>
                <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Amount</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={(Math.max(0, owedCents) / 100).toFixed(2)}
                  required
                />
              </div>
              <div className="field">
                <label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['venmo', 'cash', 'zelle', 'check', 'other'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <button className="primary" type="submit">Record payment</button>
              {owedCents > 0 && (
                <button type="button" onClick={() => setAmount((owedCents / 100).toFixed(2))}>
                  Pay all {fmt(owedCents)}
                </button>
              )}
              {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
