import { useState, type ReactNode } from 'react';

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
