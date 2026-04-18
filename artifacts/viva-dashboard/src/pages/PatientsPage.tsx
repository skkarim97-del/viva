import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";

function formatDate(d: string | null): string {
  if (!d) return "Never";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  const today = new Date();
  const days = Math.floor(
    (today.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function PatientsPage() {
  const q = useQuery({ queryKey: ["patients"], queryFn: api.patients });

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-navy">
            Your patients
          </h1>
          <p className="text-ink-mute text-sm mt-1">
            Live risk band based on the last 14 days of check-ins.
          </p>
        </div>
        {q.data && (
          <div className="text-sm text-ink-mute">
            {q.data.length} patient{q.data.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {q.isPending && (
        <div className="text-ink-mute py-12 text-center">Loading patients...</div>
      )}
      {q.isError && (
        <div className="text-bad bg-bad/10 rounded-md px-4 py-3">
          Could not load patients.
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="text-ink-mute bg-white border border-line rounded-xl p-12 text-center">
          You don't have any patients assigned yet.
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-fog text-ink-mute text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Patient</th>
                <th className="text-left px-5 py-3 font-semibold">Treatment</th>
                <th className="text-left px-5 py-3 font-semibold">
                  Last check-in
                </th>
                <th className="text-left px-5 py-3 font-semibold">Risk</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-mist/60 transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="font-semibold text-navy">{p.name}</div>
                    <div className="text-xs text-ink-mute">{p.email}</div>
                  </td>
                  <td className="px-5 py-4 text-ink-soft">
                    {p.glp1Drug ?? <span className="text-ink-mute">--</span>}
                  </td>
                  <td className="px-5 py-4 text-ink-soft">
                    {formatDate(p.lastCheckin)}
                  </td>
                  <td className="px-5 py-4">
                    <RiskBadge band={p.riskBand} score={p.riskScore} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/patients/${p.id}`}
                      className="text-accent font-semibold hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
