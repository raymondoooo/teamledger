import type { SeasonContext } from '../App.js';
import { seasonLabel } from '../api.js';

const CSVS = [
  ['roster', 'Roster', 'Players, contact details, dues, paid and balance.'],
  ['ledger', 'Payment ledger', 'Every payment recorded this season, by date.'],
  ['budget', 'Budget', 'Every expense and credit line with its category and total.'],
  ['balances', 'Balances', 'Per-player share, carried balance, dues, paid and status.'],
] as const;

export default function Exports({ ctx }: { ctx: SeasonContext }) {
  const base = `/api/seasons/${ctx.season.id}/export`;

  return (
    <>
      <p className="notice">
        Everything below is generated live from {seasonLabel(ctx.season)}. CSVs open in any
        spreadsheet — the format the next treasurer will want when you hand the books over.
      </p>

      <h2>PDF</h2>
      <div className="panel table-wrap">
        <table>
          <tbody>
            <tr>
              <td>
                <strong>Budget sheet</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  One page: each category with the total due from the team and the cost per
                  player, then the payment split. No individual players — this is the one to hand
                  round at a parents' meeting.
                </div>
              </td>
              <td className="num">
                <a className="btn" href={`${base}/budget-sheet.pdf`} style={{ textDecoration: 'none' }}>
                  Download
                </a>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Season budget report</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  Expenses by category, credits, per-player split and every balance.
                </div>
              </td>
              <td className="num">
                <a className="btn" href={`${base}/budget.pdf`} style={{ textDecoration: 'none' }}>
                  Download
                </a>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="notice">
          Individual player statements are on each player's page, under the Roster tab.
        </p>
      </div>

      <h2>Bank ledger</h2>
      <div className="panel table-wrap">
        <table>
          <tbody>
            <tr>
              <td>
                <strong>Team account ledger</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  Every debit and credit with a running balance, for the whole team — not just
                  this season.
                </div>
              </td>
              <td className="num">
                <a
                  className="btn"
                  href={`/api/teams/${ctx.team.id}/bank/export.csv`}
                  style={{ textDecoration: 'none' }}
                >
                  Download
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>CSV</h2>
      <div className="panel table-wrap">
        <table>
          <tbody>
            {CSVS.map(([kind, title, description]) => (
              <tr key={kind}>
                <td>
                  <strong>{title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>{description}</div>
                </td>
                <td className="num">
                  <a className="btn" href={`${base}/${kind}.csv`} style={{ textDecoration: 'none' }}>
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
