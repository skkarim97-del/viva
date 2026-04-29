import { useMemo, useState } from "react";
import type {
  AnalyticsSummary,
  PilotBlock,
  PilotSnapshotSummary,
  PilotSnapshotCreateRequest,
} from "@/lib/types";
import { pctStr, fmtTime } from "@/lib/format";
import { KEY_STORAGE } from "@/lib/api";
import {
  usePilotSnapshotsList,
  usePilotSnapshotDetail,
  useCreatePilotSnapshot,
  usePilotScopes,
} from "@/hooks/usePilotSnapshots";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Pilot Metrics -- the cohort-level KPI page partners ask about.
 *
 * Two modes share the same KPI layout (RiskSection / InterventionSection /
 * ProviderSection / RulesNote):
 *
 *   1. LIVE VIEW -- recomputed on every summary refresh against the
 *      rolling 30-day window.
 *   2. SNAPSHOTS -- frozen, immutable readouts persisted in
 *      pilot_snapshots. Operators can take Day-15 / Day-30 presets or
 *      custom date ranges and revisit them later. Snapshots are the
 *      intended source for any future external readout (still gated by
 *      HIPAA prerequisites).
 *
 * The operator key for snapshot fetches is read from localStorage --
 * the gate on the App shell sets it before mounting any page.
 */
export function PilotMetricsPage({ data }: { data: AnalyticsSummary }) {
  const [mode, setMode] = useState<"live" | "snapshots">("live");
  const operatorKey =
    typeof window !== "undefined"
      ? window.localStorage.getItem(KEY_STORAGE)
      : null;

  return (
    <>
      <PageHeader
        title="Pilot Metrics"
        subtitle={
          mode === "live"
            ? "Cohort-level KPIs over the last 30 days. Live, internal-only."
            : "Frozen snapshots of the pilot KPIs. Append-only, internal-only."
        }
        right={<ModeToggle mode={mode} onChange={setMode} />}
      />
      {mode === "live" ? (
        <LiveView pilot={data.pilot} />
      ) : (
        <SnapshotsView operatorKey={operatorKey} />
      )}
    </>
  );
}

// ------------------------------------------------------- mode toggle

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "live" | "snapshots";
  onChange: (m: "live" | "snapshots") => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-[rgba(20,34,64,0.12)] bg-white p-0.5 text-[12px] font-semibold"
      role="tablist"
    >
      <ToggleBtn active={mode === "live"} onClick={() => onChange("live")}>
        Live view
      </ToggleBtn>
      <ToggleBtn
        active={mode === "snapshots"}
        onClick={() => onChange("snapshots")}
      >
        Snapshots
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-md transition-colors " +
        (active
          ? "bg-[#142240] text-white"
          : "text-[#142240] hover:bg-[rgba(20,34,64,0.05)]")
      }
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------- live view

function LiveView({ pilot }: { pilot: PilotBlock | undefined }) {
  if (!pilot) {
    return (
      <Card>
        <Empty>
          Pilot metrics are temporarily unavailable. The rest of the
          dashboard is still up — try refreshing in a minute.
        </Empty>
      </Card>
    );
  }
  return (
    <>
      <div className="mb-3">
        <Chip tone="muted">Cohort {pilot.cohort.activated} activated</Chip>
      </div>
      <PilotSections pilot={pilot} />
    </>
  );
}

// ------------------------------------------------------- snapshots view

function SnapshotsView({ operatorKey }: { operatorKey: string | null }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = usePilotSnapshotsList(operatorKey);

  if (selectedId != null) {
    return (
      <SnapshotDetailView
        operatorKey={operatorKey}
        snapshotId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <>
      <NewSnapshotPanel operatorKey={operatorKey} />
      <SectionHead hint="Newest first. Click a row to view the frozen KPIs.">
        Saved snapshots
      </SectionHead>
      {list.isLoading ? (
        <Card>
          <Empty>Loading snapshots…</Empty>
        </Card>
      ) : list.isError ? (
        <Card>
          <Empty>
            Could not load snapshots ({list.error?.message ?? "error"}).
          </Empty>
        </Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <Empty>
            No snapshots yet. Take one above to freeze the current KPIs.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.data.map((s) => (
            <SnapshotRow key={s.id} s={s} onOpen={() => setSelectedId(s.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function SnapshotRow({
  s,
  onOpen,
}: {
  s: PilotSnapshotSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-[rgba(20,34,64,0.10)] bg-white px-4 py-3 hover:border-[#38B6FF] hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-[#142240]">
            {s.cohortStartDate} → {s.cohortEndDate}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {s.patientCount} patients · {scopeLabel(s)} · taken{" "}
            {new Date(s.generatedAt).toLocaleDateString()}{" "}
            {fmtTime(s.generatedAt)} by {s.generatedByLabel}
          </div>
          {s.notes ? (
            <div className="text-[12px] text-[#142240] mt-1.5 line-clamp-2">
              {s.notes}
            </div>
          ) : null}
        </div>
        <Chip tone="muted">{s.metricDefinitionVersion}</Chip>
      </div>
    </button>
  );
}

// Render a short human label describing a snapshot's scope. Whole-cohort
// snapshots (no platform, no doctor) get the "All platforms" wording so
// it's distinct from a snapshot scoped to one platform.
function scopeLabel(s: {
  platformName: string | null;
  doctorName: string | null;
}): string {
  if (s.doctorName && s.platformName) {
    return `${s.platformName} / ${s.doctorName}`;
  }
  if (s.platformName) return s.platformName;
  if (s.doctorName) return s.doctorName;
  return "All platforms";
}

// ------------------------------------------------------- snapshot detail

function SnapshotDetailView({
  operatorKey,
  snapshotId,
  onBack,
}: {
  operatorKey: string | null;
  snapshotId: number;
  onBack: () => void;
}) {
  const q = usePilotSnapshotDetail(operatorKey, snapshotId);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="text-[12px] font-semibold text-[#38B6FF] hover:underline mb-3"
      >
        ← Back to snapshots
      </button>
      {q.isLoading ? (
        <Card>
          <Empty>Loading snapshot…</Empty>
        </Card>
      ) : q.isError || !q.data ? (
        <Card>
          <Empty>
            Could not load this snapshot ({q.error?.message ?? "error"}).
          </Empty>
        </Card>
      ) : (
        <>
          <FrozenBanner s={q.data} />
          <PilotSections pilot={q.data.metrics} />
        </>
      )}
    </>
  );
}

function FrozenBanner({ s }: { s: PilotSnapshotSummary }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-block px-2 py-0.5 rounded-full bg-[#142240] text-white text-[10px] font-bold uppercase tracking-wider">
              Frozen snapshot
            </span>
            <Chip tone="muted">{s.metricDefinitionVersion}</Chip>
            <Chip tone="muted">Scope: {scopeLabel(s)}</Chip>
          </div>
          <div className="text-[14px] font-semibold text-[#142240]">
            Window: {s.cohortStartDate} → {s.cohortEndDate}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {s.patientCount} patients · taken{" "}
            {new Date(s.generatedAt).toLocaleString()} by{" "}
            {s.generatedByLabel}
          </div>
          {s.notes ? (
            <div className="text-[12px] text-[#142240] mt-2 whitespace-pre-wrap">
              {s.notes}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------- create form

function NewSnapshotPanel({ operatorKey }: { operatorKey: string | null }) {
  const [preset, setPreset] = useState<"day15" | "day30" | "custom">("day30");
  const [customStart, setCustomStart] = useState<string>(
    () => defaultCustomStart(),
  );
  const [customEnd, setCustomEnd] = useState<string>(() => todayYmd());
  const [notes, setNotes] = useState("");
  const [label, setLabel] = useState("");
  // Scope state: empty string == "all". Doctor list is filtered to the
  // selected platform when one is chosen, mirroring how doctors actually
  // belong to one platform in the data model.
  const [platformId, setPlatformId] = useState<string>("");
  const [doctorId, setDoctorId] = useState<string>("");
  const scopes = usePilotScopes(operatorKey);
  const create = useCreatePilotSnapshot(operatorKey);

  const platforms = scopes.data?.platforms ?? [];
  const doctorsAll = scopes.data?.doctors ?? [];
  const visibleDoctors = platformId
    ? doctorsAll.filter((d) => d.platformId === Number(platformId))
    : doctorsAll;
  // If the operator switches platforms and the previously-picked doctor
  // belongs to a different platform, drop it so we don't post a
  // mismatched scope. Done in render rather than effect to keep things
  // synchronous and easy to reason about.
  const effectiveDoctorId =
    doctorId && visibleDoctors.some((d) => d.id === Number(doctorId))
      ? doctorId
      : "";

  const submit = () => {
    const scopeFields = {
      ...(platformId ? { platformId: Number(platformId) } : {}),
      ...(effectiveDoctorId ? { doctorId: Number(effectiveDoctorId) } : {}),
    };
    const body: PilotSnapshotCreateRequest =
      preset === "custom"
        ? {
            cohortStartDate: customStart,
            cohortEndDate: customEnd,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(label.trim() ? { generatedByLabel: label.trim() } : {}),
            ...scopeFields,
          }
        : {
            preset,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(label.trim() ? { generatedByLabel: label.trim() } : {}),
            ...scopeFields,
          };
    create.mutate(body, {
      onSuccess: () => {
        setNotes("");
        setLabel("");
      },
    });
  };

  // Disable submit when the date range is obviously bad, so the user
  // sees the problem before round-tripping to the server.
  const customInvalid =
    preset === "custom" &&
    (!customStart || !customEnd || customEnd < customStart);

  return (
    <Card>
      <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        New snapshot
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Range">
          <select
            value={preset}
            onChange={(e) =>
              setPreset(e.target.value as "day15" | "day30" | "custom")
            }
            className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
          >
            <option value="day15">Day 15 (last 15 days)</option>
            <option value="day30">Day 30 (last 30 days)</option>
            <option value="custom">Custom range…</option>
          </select>
        </Field>
        <Field label="Platform (Viva customer)">
          <select
            value={platformId}
            onChange={(e) => {
              setPlatformId(e.target.value);
              setDoctorId(""); // changing platform invalidates doctor pick
            }}
            disabled={scopes.isLoading}
            className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
          >
            <option value="">All platforms (whole cohort)</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status !== "active" ? ` (${p.status})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Doctor (within platform)">
          <select
            value={effectiveDoctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            disabled={scopes.isLoading}
            className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
          >
            <option value="">All doctors</option>
            {visibleDoctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Generated by (label)">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="operator"
            maxLength={120}
            className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
          />
        </Field>
        <Field label="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Day 15 readout for partner check-in"
            maxLength={2000}
            className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
          />
        </Field>
      </div>
      {preset === "custom" ? (
        <div className="grid gap-3 md:grid-cols-2 mt-3">
          <Field label="Cohort start date">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
            />
          </Field>
          <Field label="Cohort end date">
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-full rounded-md border border-[rgba(20,34,64,0.15)] bg-white px-2 py-1.5 text-[13px]"
            />
          </Field>
        </div>
      ) : null}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending || customInvalid}
          className="rounded-md bg-[#142240] text-white text-[13px] font-semibold px-4 py-2 hover:bg-[#0c1830] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {create.isPending ? "Taking snapshot…" : "Take snapshot"}
        </button>
        {customInvalid ? (
          <span className="text-[12px] text-[#B5251D]">
            End date must be on or after start date.
          </span>
        ) : null}
        {create.isError ? (
          <span className="text-[12px] text-[#B5251D]">
            {create.error?.detail ?? create.error?.message ?? "Failed."}
          </span>
        ) : null}
        {create.isSuccess ? (
          <span className="text-[12px] text-[#34C759]">
            Saved. See it in the list below.
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

// Default the custom-start date to "30 days ago" so the form mirrors
// the live view's window out of the box.
function defaultCustomStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return ymd(d);
}
function todayYmd(): string {
  return ymd(new Date());
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ------------------------------------------------------- shared sections

function PilotSections({ pilot }: { pilot: PilotBlock }) {
  // Memoise the empty-window check so the conditional render below is
  // stable across re-renders. Doesn't affect correctness; just tidier.
  const isEmpty = useMemo(() => pilot.cohort.activated === 0, [pilot]);
  return (
    <>
      <RiskSection pilot={pilot} />
      <InterventionSection pilot={pilot} />
      <ProviderSection pilot={pilot} />
      <RulesNote pilot={pilot} isEmpty={isEmpty} />
    </>
  );
}

// ----- A. Earlier Risk Visibility ----------------------------------

function RiskSection({ pilot }: { pilot: PilotBlock }) {
  const r = pilot.risk;
  return (
    <>
      <SectionHead hint="Are we seeing trouble before the doctor would have?">
        Earlier risk visibility
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4">
        <StatCard
          label="% patients flagged at risk"
          value={pctStr(r.pctFlagged)}
          sub={`${r.flaggedPatients} of ${pilot.cohort.activated}`}
          accent={r.pctFlagged >= 0.4 ? "#B5251D" : "#142240"}
        />
        <StatCard
          label="Avg. risk signals per patient"
          value={r.avgSignalsPerPatient.toFixed(2)}
          sub="Fired rules / cohort"
          accent="#142240"
        />
        <StatCard
          label="High-risk patients"
          value={r.bandDistribution.high}
          sub={`${r.bandDistribution.medium} medium · ${r.bandDistribution.low} low`}
          accent="#B5251D"
        />
      </div>

      <Card>
        <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Top risk categories (% of cohort affected)
        </div>
        {r.topCategories.length === 0 ? (
          <Empty>No fired risk rules across the cohort right now.</Empty>
        ) : (
          <div className="space-y-2">
            {r.topCategories.map((c) => (
              <CategoryRow
                key={c.code}
                label={c.label}
                count={c.patients}
                pct={c.pct}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ----- B. Intervention Performance ---------------------------------

function InterventionSection({ pilot }: { pilot: PilotBlock }) {
  const i = pilot.interventions;
  return (
    <>
      <SectionHead hint={`Auto-resolve and engagement windows: ${pilot.rules.autoResolveWindowHours}h`}>
        Intervention performance
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
        <StatCard
          label="# interventions triggered"
          value={i.triggered}
          sub={`${i.perPatient.toFixed(2)} per patient`}
          accent="#142240"
        />
        <StatCard
          label="% engaged with"
          value={pctStr(i.pctEngaged)}
          sub={`${i.engaged} of ${i.triggered}`}
          accent="#38B6FF"
        />
        <StatCard
          label="% auto-resolved (48h)"
          value={pctStr(i.pctAutoResolved)}
          sub={`${i.autoResolved} no escalation`}
          accent="#34C759"
        />
        <StatCard
          label="% escalated (48h)"
          value={pctStr(i.pctEscalated)}
          sub={`${i.escalated} escalated`}
          accent="#FF9500"
        />
      </div>
      <div className="text-[11px] text-muted-foreground mb-4">
        Engagement is a loose join (same patient + intervention feedback within{" "}
        {pilot.rules.engagementWindowHours}h). Tighten by linking
        intervention_feedback to a specific intervention_event.id when ready.
      </div>
    </>
  );
}

// ----- C. Provider Leverage ----------------------------------------

function ProviderSection({ pilot }: { pilot: PilotBlock }) {
  const p = pilot.provider;
  const tHours = p.avgTimeToFollowUpHours;
  return (
    <>
      <SectionHead hint={`Escalations deduped per patient per ${pilot.rules.escalationDedupeHours}h`}>
        Provider leverage
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
        <StatCard
          label="# patients escalated"
          value={p.patientsEscalated}
          sub={`${p.escalationsDeduped} escalations · ${p.escalationsRaw} raw`}
          accent="#142240"
        />
        <StatCard
          label="Avg. time-to-follow-up"
          value={fmtHours(tHours)}
          sub={
            p.timeToFollowUpDenom > 0
              ? `Across ${p.timeToFollowUpDenom} linked follow-ups`
              : "No linked follow-ups yet"
          }
          accent="#38B6FF"
        />
        <StatCard
          label="% escalations reviewed"
          value={pctStr(p.pctReviewed)}
          sub="doctor_reviewed before next escalation"
          accent="#142240"
        />
        <StatCard
          label="% escalations acted on"
          value={pctStr(p.pctActedOn)}
          sub="follow_up_completed linked"
          accent={p.pctActedOn >= 0.6 ? "#34C759" : "#FF9500"}
        />
      </div>
    </>
  );
}

// ----- Rules footnote ---------------------------------------------

function RulesNote({ pilot, isEmpty }: { pilot: PilotBlock; isEmpty: boolean }) {
  const r = pilot.rules;
  return (
    <Card>
      <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        How these are computed
      </div>
      <ul className="text-[12px] text-muted-foreground space-y-1.5 leading-relaxed">
        <li>
          <strong>Cohort:</strong> patients activated on or before the window
          end date.{" "}
          {pilot.scope?.platformName || pilot.scope?.doctorName
            ? `Scope: ${pilot.scope.platformName ?? "all platforms"}${
                pilot.scope.doctorName
                  ? ` / ${pilot.scope.doctorName}`
                  : " / all doctors"
              }.`
            : "Whole-cohort (every platform, every doctor)."}
        </li>
        <li>
          <strong>Window:</strong> {pilot.windowDays} days
          {pilot.windowStartDate && pilot.windowEndDate
            ? ` (${pilot.windowStartDate} → ${pilot.windowEndDate})`
            : ""}
          .
        </li>
        <li>
          <strong>Risk:</strong> {r.riskBandSource.replace(/_/g, " ")} from the same lib/risk.computeRisk used by the doctor dashboard. Not materialized.
        </li>
        <li>
          <strong>Auto-resolve:</strong> intervention with no escalation_requested by the same patient within {r.autoResolveWindowHours}h.
        </li>
        <li>
          <strong>Engagement:</strong> {r.engagementJoin.replace(/_/g, " ")}. Type-matching deferred until the schema is tightened.
        </li>
        <li>
          <strong>Escalation dedupe:</strong> per patient per {r.escalationDedupeHours}h. Raw count shown alongside for sanity.
        </li>
        <li>
          <strong>Reviewed:</strong> {r.reviewedDefinition.replace(/_/g, " ")}.
        </li>
        <li>
          <strong>Acted on:</strong> {r.actedOnDefinition.replace(/_/g, " ")} — doctor_reviewed alone does NOT count.
        </li>
        <li>
          <strong>External readout:</strong> a future external endpoint will
          read from frozen snapshots in `pilot_snapshots` (never live
          numbers); currently disabled until HIPAA prerequisites are
          resolved.
        </li>
        {isEmpty ? (
          <li>
            <strong>Note:</strong> the cohort was empty for this window —
            all KPIs read zero by definition.
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

// ----- helpers -----------------------------------------------------

function CategoryRow({
  label,
  count,
  pct,
}: {
  label: string;
  count: number;
  pct: number;
}) {
  const widthPct = Math.max(2, Math.round(pct * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] mb-1">
        <span className="font-semibold text-[#142240]">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {pctStr(pct)} · {count}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-[rgba(20,34,64,0.08)] overflow-hidden"
        aria-hidden
      >
        <div
          className="h-full bg-[#38B6FF]"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) {
    const m = Math.round(h * 60);
    return `${m}m`;
  }
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = h / 24;
  return `${d.toFixed(1)}d`;
}
