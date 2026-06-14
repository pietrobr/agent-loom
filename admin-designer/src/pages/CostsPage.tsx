import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Text,
  Spinner,
  MessageBar,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  makeStyles,
  tokens,
  Dropdown,
  Option,
} from "@fluentui/react-components";
import { api, CostSummary, Tenant } from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "960px" },
  stats: { display: "flex", gap: "16px", flexWrap: "wrap" },
  stat: { padding: "16px", flexGrow: 1, textAlign: "center", minWidth: "180px" },
  chartCard: { padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  chart: { display: "flex", alignItems: "flex-end", gap: "12px", height: "180px", paddingTop: "8px" },
  barCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "6px",
    flex: 1,
    minWidth: 0,
  },
  bar: {
    width: "100%",
    maxWidth: "56px",
    borderRadius: "6px 6px 0 0",
    background: "linear-gradient(180deg, #00A8A8 0%, #138DDE 60%, #4F6BFF 100%)",
  },
  barLabel: { fontSize: "11px", color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" },
  barValue: { fontSize: "11px", color: tokens.colorNeutralForeground2 },
  monthCard: { padding: "16px", display: "flex", flexDirection: "column", gap: "8px" },
  monthHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  meta: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" },
  nameCell: { minWidth: "220px", whiteSpace: "nowrap" },
  projGap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
  },
});

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** Currency with extra precision for tiny token costs (e.g. $0.0035). */
function smallMoney(n: number, currency: string): string {
  if (n > 0 && n < 0.01) {
    // Pick enough decimals to surface the first two significant digits, so even
    // a $0.00003 embedding cost is visible instead of rounding to $0.0000.
    const decimals = Math.min(8, Math.max(4, -Math.floor(Math.log10(n)) + 1));
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
    } catch {
      return `${n.toFixed(decimals)} ${currency}`;
    }
  }
  return money(n, currency);
}

const INFRA_LABELS: Record<string, string> = {
  ai_search: "AI Search",
  container_apps: "Container Apps",
  container_registry: "Container Registry",
  cosmos_db: "Cosmos DB",
  log_analytics: "Log Analytics",
  storage: "Storage",
  key_vault: "Key Vault",
  ai_foundry_base: "AI Foundry (base)",
};

const CURRENCY_KEY = "agentloom.costCurrency";
const CURRENCIES = ["USD", "EUR"];

export function CostsPage() {
  const styles = useStyles();
  const [data, setData] = useState<CostSummary | null>(null);
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  // Currency choice is remembered across browser sessions.
  const [costCurrency, setCostCurrency] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENCY_KEY) || "USD";
    } catch {
      return "USD";
    }
  });

  useEffect(() => {
    setLoading(true);
    api
      .costs(costCurrency)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [costCurrency]);

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

  const changeCurrency = (c: string) => {
    setCostCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore storage failures (private mode) */
    }
  };

  // Lifecycle status per org for the badge under each client name. A client that
  // is no longer a tenant (deleted) is shown as Closed.
  const statusByOrg = useMemo(() => {
    const m: Record<string, { label: string; color: "success" | "warning" | "danger" }> = {};
    for (const t of customers) {
      m[t.org_id] =
        (t as any).status === "closed"
          ? { label: "Closed", color: "danger" }
          : t.enabled === false
          ? { label: "Suspended", color: "warning" }
          : { label: "Open", color: "success" };
    }
    return m;
  }, [customers]);
  const statusOf = (orgId: string) =>
    statusByOrg[orgId] || { label: "Closed", color: "danger" as const };

  const currency = data?.currency || costCurrency;
  const maxMonth = useMemo(
    () => Math.max(1, ...(data?.by_month || []).map((m) => m.total_cost)),
    [data]
  );
  // Chart shows oldest → newest (by_month arrives newest-first).
  const chartMonths = useMemo(() => [...(data?.by_month || [])].reverse(), [data]);

  // End-of-month projection for the current (most recent) month. Open customers
  // are linearly extrapolated from their current per-active-day rate to the full
  // month; closed/suspended ones are frozen at their current cost.
  const projection = useMemo(() => {
    const cur = data?.by_month?.[0];
    if (!cur) return null;
    const daysInMonth = cur.days_in_month || 30;
    const rows = cur.clients.map((c) => {
      const st = statusOf(c.org_id).label;
      const open = st === "Open";
      const activeDays = Math.max(1, c.active_days || 1);
      const factor = open ? daysInMonth / activeDays : 1;
      return {
        org_id: c.org_id,
        name: c.name,
        open,
        current_total: c.total_cost,
        current_infra: c.infra_cost,
        projected_total: c.total_cost * factor,
        projected_infra: c.infra_cost * factor,
      };
    });
    const projectedInfraRecovered = rows.reduce((s, r) => s + r.projected_infra, 0);
    const projectedTotal = rows.reduce((s, r) => s + r.projected_total, 0);
    const infraMonthly = data?.infra_monthly || 0;
    const gap = Math.max(0, infraMonthly - projectedInfraRecovered);
    return { month: cur.month, daysInMonth, rows, projectedInfraRecovered, projectedTotal, infraMonthly, gap };
  }, [data, statusByOrg]);

  return (
    <div className={styles.wrap}>
      <div className={styles.meta}>
        <Text weight="semibold" size={500}>
          Azure solution costs
        </Text>
        {data?.updated && (
          <Badge appearance="tint" color="informative">
            prices {String(data.updated).slice(0, 10)}
          </Badge>
        )}
        {data?.region && <Badge appearance="tint">{data.region}</Badge>}
        {data?.source && (
          <Text size={200} italic>
            source: {data.source}
          </Text>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <Text size={200}>Currency</Text>
          <Dropdown
            aria-label="Display currency"
            style={{ minWidth: "96px" }}
            selectedOptions={[costCurrency]}
            value={costCurrency}
            onOptionSelect={(_, d) => d.optionValue && changeCurrency(d.optionValue)}
          >
            {CURRENCIES.map((c) => (
              <Option key={c} value={c}>
                {c}
              </Option>
            ))}
          </Dropdown>
        </div>
      </div>

      {loading && <Spinner label="Loading…" />}
      {err && <MessageBar intent="error">{err}</MessageBar>}

      {data && (
        <>
          <div className={styles.stats}>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {money(data.total_cost, currency)}
              </Text>
              <div>
                <Text size={200}>total estimated cost</Text>
              </div>
            </Card>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {money(data.infra_monthly, currency)}
              </Text>
              <div>
                <Text size={200}>shared infrastructure / month</Text>
              </div>
            </Card>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {data.by_month.length}
              </Text>
              <div>
                <Text size={200}>months with usage</Text>
              </div>
            </Card>
          </div>

          <Card className={styles.monthCard}>
            <Text weight="semibold">Shared infrastructure (per month, split across active customers)</Text>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Component</TableHeaderCell>
                  <TableHeaderCell>Monthly cost</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.infra_breakdown || {}).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>{INFRA_LABELS[k] || k}</TableCell>
                    <TableCell>{money(v, currency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <Text weight="semibold">Total</Text>
                  </TableCell>
                  <TableCell>
                    <Text weight="semibold">{money(data.infra_monthly, currency)}</Text>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>

          <Card className={styles.chartCard}>
            <Text weight="semibold">Monthly cost</Text>
            {chartMonths.length === 0 ? (
              <Text size={200} italic>
                No cost recorded yet.
              </Text>
            ) : (
              <div className={styles.chart}>
                {chartMonths.map((m) => (
                  <div
                    key={m.month}
                    className={styles.barCol}
                    title={`${money(m.total_cost, currency)} (tokens ${money(
                      m.token_cost,
                      currency
                    )} · search ${money(m.search_cost, currency)})`}
                  >
                    <span className={styles.barValue}>{money(m.total_cost, currency)}</span>
                    <div
                      className={styles.bar}
                      style={{ height: `${Math.round((m.total_cost / maxMonth) * 130)}px` }}
                    />
                    <span className={styles.barLabel}>{m.month}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {projection && (
            <Card className={styles.monthCard}>
              <div className={styles.monthHead}>
                <Text weight="semibold">End-of-month projection · {projection.month}</Text>
                <Text weight="semibold">{money(projection.projectedTotal, currency)}</Text>
              </div>
              <Text size={200} italic>
                Open customers are extrapolated from their current daily rate to all{" "}
                {projection.daysInMonth} days; suspended/closed ones are frozen at today's cost.
              </Text>
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className={styles.nameCell}>Customer</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Current total</TableHeaderCell>
                    <TableHeaderCell>Projected EOM</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projection.rows.map((r) => (
                    <TableRow key={r.org_id}>
                      <TableCell className={styles.nameCell}>{r.name}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color={statusOf(r.org_id).color}>
                          {statusOf(r.org_id).label}
                        </Badge>
                      </TableCell>
                      <TableCell>{money(r.current_total, currency)}</TableCell>
                      <TableCell>
                        <Text weight="semibold">{money(r.projected_total, currency)}</Text>
                        {r.open && r.projected_total > r.current_total && (
                          <Text size={100} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                            {" "}(+{money(r.projected_total - r.current_total, currency)})
                          </Text>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div
                className={styles.projGap}
                style={{
                  backgroundColor:
                    projection.gap > 0
                      ? tokens.colorPaletteRedBackground2
                      : tokens.colorPaletteGreenBackground2,
                }}
              >
                <div>
                  <Text weight="semibold">
                    {projection.gap > 0 ? "Architecture not yet covered" : "Architecture fully covered"}
                  </Text>
                  <div>
                    <Text size={200}>
                      Projected infra recovered {money(projection.projectedInfraRecovered, currency)} of{" "}
                      {money(projection.infraMonthly, currency)} monthly
                    </Text>
                  </div>
                </div>
                <Text size={500} weight="bold">
                  {projection.gap > 0 ? `-${money(projection.gap, currency)}` : money(0, currency)}
                </Text>
              </div>
            </Card>
          )}

          {data.by_month.map((m) => (
            <Card key={m.month} className={styles.monthCard}>
              <div className={styles.monthHead}>
                <Text weight="semibold">{m.month}</Text>
                <Text weight="semibold">{money(m.total_cost, currency)}</Text>
              </div>
              {m.weights && (
                <Text size={200} italic>
                  Infra split weighted by tokens {Math.round(m.weights.tokens * 100)}% · calls{" "}
                  {Math.round(m.weights.calls * 100)}% · documents{" "}
                  {Math.round(m.weights.documents * 100)}%
                </Text>
              )}
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className={styles.nameCell}>Customer</TableHeaderCell>
                    <TableHeaderCell>Tokens</TableHeaderCell>
                    <TableHeaderCell>Calls</TableHeaderCell>
                    <TableHeaderCell>Documents</TableHeaderCell>
                    <TableHeaderCell>Active days</TableHeaderCell>
                    <TableHeaderCell>Infra share</TableHeaderCell>
                    <TableHeaderCell>Token cost</TableHeaderCell>
                    <TableHeaderCell>Embedding</TableHeaderCell>
                    <TableHeaderCell>Infra cost</TableHeaderCell>
                    <TableHeaderCell>Total</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.clients.map((c) => (
                    <TableRow key={c.org_id}>
                      <TableCell className={styles.nameCell}>
                        <div>
                          <Text>{c.name}</Text>
                          <div>
                            <Badge appearance="filled" color={statusOf(c.org_id).color}>
                              {statusOf(c.org_id).label}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{c.tokens.toLocaleString()}</TableCell>
                      <TableCell>{c.calls}</TableCell>
                      <TableCell>{(c.documents ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        {c.active_days ?? "—"}
                        {c.days_in_month ? ` / ${c.days_in_month}` : ""}
                      </TableCell>
                      <TableCell>{Math.round((c.infra_weight ?? 0) * 100)}%</TableCell>
                      <TableCell>{smallMoney(c.token_cost, currency)}</TableCell>
                      <TableCell title={`${(c.embedding_tokens ?? 0).toLocaleString()} tokens`}>
                        {smallMoney(c.embedding_cost ?? 0, currency)}
                      </TableCell>
                      <TableCell>{money(c.infra_cost, currency)}</TableCell>
                      <TableCell>
                        <Text weight="semibold">{money(c.total_cost, currency)}</Text>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}

          {data.by_month.length === 0 && (
            <Text size={200} italic>
              No usage has been recorded yet, so there is no cost to attribute.
            </Text>
          )}
        </>
      )}
    </div>
  );
}
