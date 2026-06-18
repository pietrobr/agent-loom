import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Text,
  Label,
  Input,
  Dropdown,
  Option,
  Badge,
  Spinner,
  MessageBar,
  OverlayDrawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  makeStyles,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  Dismiss24Regular,
  Eye20Regular,
} from "@fluentui/react-icons";
import {
  api,
  Tenant,
  TraceSummary,
  TraceDetail,
  TraceSpan,
  TraceLevel,
} from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "1100px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: "12px",
    padding: "12px",
  },
  field: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "160px" },
  levelBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px",
    flexWrap: "wrap",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 10px",
    fontSize: "13px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: "top",
  },
  rowClickable: { cursor: "pointer" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    padding: "40px 16px",
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    color: tokens.colorNeutralForeground3,
  },
  // Waterfall
  spanRow: { display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" },
  spanName: { width: "220px", flexShrink: 0, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  track: { position: "relative", flexGrow: 1, height: "16px", background: tokens.colorNeutralBackground3, borderRadius: "3px" },
  bar: { position: "absolute", top: 0, height: "16px", borderRadius: "3px", minWidth: "2px" },
  spanMs: { width: "70px", textAlign: "right", flexShrink: 0, fontSize: "11px", color: tokens.colorNeutralForeground3 },
  eventLine: { fontSize: "12px", padding: "2px 0", display: "flex", gap: "8px", alignItems: "baseline" },
  attrs: { color: tokens.colorNeutralForeground3, fontSize: "11px" },
});

const LEVEL_COLOR: Record<TraceLevel, "informative" | "success" | "warning" | "danger"> = {
  DEBUG: "informative",
  INFO: "success",
  WARNING: "warning",
  ERROR: "danger",
};

const LEVEL_HELP: Record<TraceLevel, string> = {
  DEBUG: "Verbose — capture every request, including debug events.",
  INFO: "Capture every request (default).",
  WARNING: "Capture only requests that warned or failed.",
  ERROR: "Capture only failed requests.",
};

// Sentinel for the customer filter: "all customers but not the _system
// (admin) partition". Empty string = truly all partitions including _system.
const NO_SYSTEM = "__no_system__";

function levelBadge(level: TraceLevel) {
  return (
    <Badge appearance="filled" color={LEVEL_COLOR[level] || "informative"}>
      {level}
    </Badge>
  );
}

function statusBadge(status: number) {
  const color = status === 0 ? "subtle" : status < 400 ? "success" : status < 500 ? "warning" : "danger";
  return (
    <Badge appearance="tint" color={color as any}>
      {status || "—"}
    </Badge>
  );
}

function barColor(level: TraceLevel, status: "ok" | "error"): string {
  if (status === "error" || level === "ERROR") return tokens.colorPaletteRedBackground3;
  if (level === "WARNING") return tokens.colorPaletteYellowBackground3;
  return tokens.colorBrandBackground;
}

/** Distributed-tracing console: filter request traces by customer/date/level
 *  and inspect the round-trip span waterfall + events + errors. */
export function TracingPage() {
  const styles = useStyles();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Filters
  const [org, setOrg] = useState<string>(NO_SYSTEM);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [minLevel, setMinLevel] = useState<string>("");

  // Capture level
  const [captureLevel, setCaptureLevel] = useState<TraceLevel | "">("");
  const [savingLevel, setSavingLevel] = useState(false);

  // Detail drawer
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const nameByOrg = useMemo(() => {
    const m: Record<string, string> = {};
    tenants.forEach((t) => (m[t.org_id] = t.name));
    return m;
  }, [tenants]);

  async function loadTenants() {
    try {
      setTenants(await api.listCustomers());
    } catch {
      /* non-fatal for the page */
    }
  }

  async function loadConfig() {
    try {
      const cfg = await api.getTracingConfig();
      setCaptureLevel(cfg.level);
    } catch {
      /* non-fatal */
    }
  }

  function toIso(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  async function loadTraces() {
    setLoading(true);
    setErr("");
    try {
      const rows = await api.listTraces({
        org_id: org && org !== NO_SYSTEM ? org : undefined,
        exclude_system: org === NO_SYSTEM,
        from: toIso(from),
        to: toIso(to),
        level: minLevel || undefined,
        limit: 200,
      });
      setTraces(rows);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTenants();
    loadConfig();
    loadTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyCaptureLevel(level: TraceLevel) {
    setSavingLevel(true);
    setErr("");
    try {
      const cfg = await api.setTracingConfig(level);
      setCaptureLevel(cfg.level);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSavingLevel(false);
    }
  }

  async function openDetail(t: TraceSummary) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.getTrace(t.org_id, t.id);
      setDetail(d);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.header}>
          <Text weight="semibold" size={500}>
            Tracing
          </Text>
          <Button icon={<ArrowClockwise20Regular />} onClick={loadTraces} disabled={loading}>
            Refresh
          </Button>
        </div>

        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Distributed traces of backend requests — the round trip each call makes through
          Cosmos, Search and Foundry, with timings, events and errors. Traces auto-expire after 14 days.
        </Text>

        {/* Capture level control */}
        <Card>
          <div className={styles.levelBar}>
            <Label weight="semibold">Capture level</Label>
            <Dropdown
              style={{ minWidth: 130 }}
              value={captureLevel || "…"}
              selectedOptions={captureLevel ? [captureLevel] : []}
              disabled={savingLevel || !captureLevel}
              onOptionSelect={(_, d) => applyCaptureLevel(d.optionValue as TraceLevel)}
            >
              <Option value="DEBUG">DEBUG (verbose)</Option>
              <Option value="INFO">INFO</Option>
              <Option value="WARNING">WARNING</Option>
              <Option value="ERROR">ERROR</Option>
            </Dropdown>
            {savingLevel && <Spinner size="tiny" />}
            {captureLevel && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {LEVEL_HELP[captureLevel]}
              </Text>
            )}
          </div>
        </Card>

        {/* Filters */}
        <Card>
          <div className={styles.filters}>
            <div className={styles.field}>
              <Label size="small">Customer</Label>
              <Dropdown
                placeholder="All customers"
                value={
                  org === NO_SYSTEM
                    ? "All customers (excl. system)"
                    : org
                    ? nameByOrg[org] || org
                    : "All customers"
                }
                selectedOptions={[org]}
                onOptionSelect={(_, d) => setOrg(d.optionValue as string)}
              >
                <Option value="">All customers</Option>
                <Option value={NO_SYSTEM}>All customers (excl. system)</Option>
                <Option value="_system">_system (admin)</Option>
                {tenants.map((t) => (
                  <Option key={t.org_id} value={t.org_id}>
                    {t.name}
                  </Option>
                ))}
              </Dropdown>
            </div>
            <div className={styles.field}>
              <Label size="small">From</Label>
              <Input type="datetime-local" value={from} onChange={(_, d) => setFrom(d.value)} />
            </div>
            <div className={styles.field}>
              <Label size="small">To</Label>
              <Input type="datetime-local" value={to} onChange={(_, d) => setTo(d.value)} />
            </div>
            <div className={styles.field}>
              <Label size="small">Min level</Label>
              <Dropdown
                placeholder="Any"
                value={minLevel || "Any"}
                selectedOptions={[minLevel]}
                onOptionSelect={(_, d) => setMinLevel(d.optionValue as string)}
              >
                <Option value="">Any</Option>
                <Option value="INFO">INFO</Option>
                <Option value="WARNING">WARNING</Option>
                <Option value="ERROR">ERROR</Option>
              </Dropdown>
            </div>
            <Button appearance="primary" onClick={loadTraces} disabled={loading}>
              Apply
            </Button>
            <Button
              appearance="subtle"
              onClick={() => {
                setOrg(NO_SYSTEM);
                setFrom("");
                setTo("");
                setMinLevel("");
                setTimeout(loadTraces, 0);
              }}
            >
              Clear
            </Button>
          </div>
        </Card>

        {err && <MessageBar intent="error">{err}</MessageBar>}
        {loading && <Spinner label="Loading traces…" />}

        {!loading && traces.length === 0 && (
          <div className={styles.empty}>
            <Text size={400} weight="semibold">No traces yet</Text>
            <Text size={200}>
              Traces appear here as customers and admins use the app. Lower the capture level to
              ERROR/WARNING to keep only problem requests.
            </Text>
          </div>
        )}

        {!loading && traces.length > 0 && (
          <Card>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Time (UTC)</th>
                  <th className={styles.th}>Customer</th>
                  <th className={styles.th}>Request</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}>Duration</th>
                  <th className={styles.th}>Level</th>
                  <th className={styles.th}>Error</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => (
                  <tr key={`${t.org_id}:${t.id}`} className={styles.rowClickable} onClick={() => openDetail(t)}>
                    <td className={styles.td}>
                      <span className={styles.mono}>{t.ts?.replace("T", " ").slice(0, 19)}</span>
                    </td>
                    <td className={styles.td}>{nameByOrg[t.org_id] || t.org_id}</td>
                    <td className={styles.td}>
                      <span className={styles.mono}>
                        {t.method} {t.path}
                      </span>
                    </td>
                    <td className={styles.td}>{statusBadge(t.status)}</td>
                    <td className={styles.td}>{Math.round(t.duration_ms)} ms</td>
                    <td className={styles.td}>{levelBadge(t.level)}</td>
                    <td className={styles.td}>
                      {t.error ? (
                        <Tooltip content={t.error.message} relationship="label">
                          <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                            {t.error.type}
                          </Text>
                        </Tooltip>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className={styles.td}>
                      <Button size="small" appearance="subtle" icon={<Eye20Regular />}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <OverlayDrawer
        position="end"
        size="large"
        open={!!detail || detailLoading}
        onOpenChange={(_, d) => !d.open && setDetail(null)}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                aria-label="Close"
                icon={<Dismiss24Regular />}
                onClick={() => setDetail(null)}
              />
            }
          >
            Trace detail
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          {detailLoading && <Spinner label="Loading trace…" />}
          {detail && <TraceDetailView trace={detail} />}
        </DrawerBody>
      </OverlayDrawer>
    </>
  );
}

function TraceDetailView({ trace }: { trace: TraceDetail }) {
  const styles = useStyles();
  const total = Math.max(trace.duration_ms, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
      <div>
        <Text className={styles.mono} size={300}>
          {trace.method} {trace.path}
        </Text>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          {statusBadge(trace.status)}
          {levelBadge(trace.level)}
          <Badge appearance="outline">{Math.round(trace.duration_ms)} ms</Badge>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {trace.org_id} · {trace.ts?.replace("T", " ").slice(0, 19)} UTC
          </Text>
        </div>
        {trace.user && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            user: <span className={styles.mono}>{trace.user}</span>
          </Text>
        )}
      </div>

      {trace.error && (
        <MessageBar intent="error">
          <b>{trace.error.type}</b>: {trace.error.message}
        </MessageBar>
      )}

      <div>
        <Text weight="semibold" size={300}>Span timeline</Text>
        <div style={{ marginTop: 8 }}>
          {trace.spans.length === 0 && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              No child spans recorded for this request.
            </Text>
          )}
          {trace.spans.map((sp) => (
            <SpanBar key={sp.id} span={sp} total={total} />
          ))}
        </div>
      </div>

      {(trace.root_events?.length || 0) > 0 && (
        <div>
          <Text weight="semibold" size={300}>Events</Text>
          <div style={{ marginTop: 6 }}>
            {trace.root_events!.map((e, i) => (
              <div key={i} className={styles.eventLine}>
                {levelBadge(e.level)}
                <span>{e.message}</span>
                <span className={styles.attrs}>{fmtAttrs(e.attributes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpanBar({ span, total }: { span: TraceSpan; total: number }) {
  const styles = useStyles();
  const leftPct = Math.min(100, (span.start_ms / total) * 100);
  const widthPct = Math.min(100 - leftPct, Math.max(0.5, (span.duration_ms / total) * 100));
  return (
    <div>
      <div className={styles.spanRow}>
        <Tooltip content={span.name} relationship="label">
          <span className={styles.spanName}>
            {span.status === "error" ? "⛔ " : ""}
            {span.name}
          </span>
        </Tooltip>
        <div className={styles.track}>
          <div
            className={styles.bar}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              background: barColor(span.level, span.status),
            }}
          />
        </div>
        <span className={styles.spanMs}>{Math.round(span.duration_ms)} ms</span>
      </div>
      {span.error && (
        <div style={{ marginLeft: 228, marginBottom: 4 }}>
          <Text size={100} style={{ color: tokens.colorPaletteRedForeground1 }}>
            {span.error.type}: {span.error.message}
          </Text>
        </div>
      )}
      {(span.events?.length || 0) > 0 && (
        <div style={{ marginLeft: 228, marginBottom: 4 }}>
          {span.events!.map((e, i) => (
            <div key={i} className={styles.eventLine}>
              {levelBadge(e.level)}
              <span>{e.message}</span>
              <span className={styles.attrs}>{fmtAttrs(e.attributes)}</span>
            </div>
          ))}
        </div>
      )}
      {span.attributes && Object.keys(span.attributes).length > 0 && (
        <div style={{ marginLeft: 228, marginBottom: 6 }}>
          <Text size={100} className={styles.attrs}>{fmtAttrs(span.attributes)}</Text>
        </div>
      )}
    </div>
  );
}

function fmtAttrs(attrs?: Record<string, unknown>): string {
  if (!attrs) return "";
  const entries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${v}`).join("  ");
}
