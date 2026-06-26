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
  barProvider: {
    width: "100%",
    maxWidth: "56px",
    borderRadius: "6px 6px 0 0",
    background: "linear-gradient(180deg, #B3B0AD 0%, #605E5C 100%)",
  },
  barStack: { display: "flex", flexDirection: "column", justifyContent: "flex-end", width: "100%", maxWidth: "56px" },
  barProjected: {
    width: "100%",
    borderRadius: "6px 6px 0 0",
    background: "repeating-linear-gradient(45deg, rgba(79,107,255,0.55) 0 5px, rgba(79,107,255,0.18) 5px 10px)",
  },
  barPair: { display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "10px", height: "150px" },
  barUnit: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
    width: "48px",
  },
  legend: { display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" },
  legendItem: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", color: tokens.colorNeutralForeground2 },
  swatchClients: { width: "12px", height: "12px", borderRadius: "3px", background: "linear-gradient(180deg, #00A8A8 0%, #4F6BFF 100%)" },
  swatchProvider: { width: "12px", height: "12px", borderRadius: "3px", background: "linear-gradient(180deg, #B3B0AD 0%, #605E5C 100%)" },
  swatchProjected: { width: "12px", height: "12px", borderRadius: "3px", background: "repeating-linear-gradient(45deg, rgba(79,107,255,0.6) 0 4px, rgba(79,107,255,0.2) 4px 8px)" },
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
  app_insights: "App Insights",
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
  // What the provider actually pays in a month: the full fixed platform cost
  // (paid whether or not customers are active) + all variable AI usage.
  const infraMonthly = data?.infra_monthly || 0;
  const providerSpend = (m: {
    token_cost: number;
    embedding_cost?: number;
    agentic_cost?: number;
  }) => infraMonthly + (m.token_cost || 0) + (m.embedding_cost || 0) + (m.agentic_cost || 0);
  // Chart shows oldest → newest (by_month arrives newest-first).
  const chartMonths = useMemo(() => [...(data?.by_month || [])].reverse(), [data]);

  // End-of-month projection for the current (most recent) month. Open customers
  // are linearly extrapolated from their current per-active-day rate to the full
  // month; closed/suspended ones are frozen at their current cost.
  const projection = useMemo(() => {
    const cur = data?.by_month?.[0];
    if (!cur) return null;
    const daysInMonth = cur.days_in_month || 30;
    // Project the REMAINING days of the month at each customer's current daily
    // rate and ADD them to what they've already spent (we don't re-scale the
    // whole month). Remaining days apply only to the current calendar month.
    const now = new Date();
    const curMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const remainingDays =
      cur.month === curMonth ? Math.max(0, daysInMonth - now.getUTCDate()) : 0;
    const rows = cur.clients.map((c) => {
      const st = statusOf(c.org_id).label;
      const open = st === "Open";
      const activeDays = Math.max(1, c.active_days || 1);
      const dailyTotal = c.total_cost / activeDays;
      const dailyInfra = c.infra_cost / activeDays;
      const addDays = open ? remainingDays : 0;
      return {
        org_id: c.org_id,
        name: c.name,
        open,
        current_total: c.total_cost,
        current_infra: c.infra_cost,
        daily_rate: dailyTotal,
        projected_total: c.total_cost + dailyTotal * addDays,
        projected_infra: c.infra_cost + dailyInfra * addDays,
      };
    });
    const projectedInfraRecovered = rows.reduce((s, r) => s + r.projected_infra, 0);
    const projectedTotal = rows.reduce((s, r) => s + r.projected_total, 0);
    const infraMonthly = data?.infra_monthly || 0;
    const gap = Math.max(0, infraMonthly - projectedInfraRecovered);
    return { month: cur.month, daysInMonth, remainingDays, rows, projectedInfraRecovered, projectedTotal, infraMonthly, gap };
  }, [data, statusByOrg]);

  // Chart Y-scale must also fit the projected (stacked) billable bar.
  const maxMonth = useMemo(() => {
    const vals: number[] = [];
    for (const m of data?.by_month || []) vals.push(m.total_cost, providerSpend(m));
    if (projection) vals.push(projection.projectedTotal);
    return Math.max(1, ...vals);
  }, [data, projection]);

  // What the SaaS owner actually pays at month end: the fixed shared platform
  // plus the variable AI usage (LLM tokens, embeddings, agentic) for the current month.
  const ownerBill = useMemo(() => {
    const cur = data?.by_month?.[0];
    const platform = data?.infra_monthly || 0;
    const tokens = cur?.token_cost || 0;
    const embedding = cur?.embedding_cost || 0;
    const agentic = cur?.agentic_cost || 0;
    return {
      month: cur?.month,
      platform,
      tokens,
      embedding,
      agentic,
      total: platform + tokens + embedding + agentic,
    };
  }, [data]);

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

          <Card className={styles.monthCard} style={{ order: 1 }}>
            <div className={styles.monthHead}>
              <Text weight="semibold">Total monthly cost — platform + AI usage</Text>
              <Text weight="semibold">{money(ownerBill.total, currency)}</Text>
            </div>
            <Text size={200} italic>
              What the SaaS owner pays at month end: the fixed shared Azure platform
              (billed whether or not customers are active) plus the variable AI usage —
              LLM chat tokens, embeddings and agentic retrieval — for{" "}
              {ownerBill.month || "the current month"}. The same costs are attributed
              per customer in the breakdown below.
            </Text>
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
                    <Text weight="semibold">Platform subtotal (fixed)</Text>
                  </TableCell>
                  <TableCell>
                    <Text weight="semibold">{money(ownerBill.platform, currency)}</Text>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>LLM chat (tokens)</TableCell>
                  <TableCell>{smallMoney(ownerBill.tokens, currency)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Embeddings (indexing)</TableCell>
                  <TableCell>{smallMoney(ownerBill.embedding, currency)}</TableCell>
                </TableRow>
                {ownerBill.agentic > 0 && (
                  <TableRow>
                    <TableCell>Agentic retrieval (planning)</TableCell>
                    <TableCell>{smallMoney(ownerBill.agentic, currency)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell>
                    <Text weight="semibold">Total (platform + AI usage)</Text>
                  </TableCell>
                  <TableCell>
                    <Text weight="semibold">{money(ownerBill.total, currency)}</Text>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>

          <Card className={styles.chartCard} style={{ order: 3 }}>
            <Text weight="semibold">Spend so far this month — customers vs. provider</Text>
            <Text size={200} italic>
              <b>Customers</b> = what you can bill so far (each customer's AI usage + their share of
              the platform); the striped segment on top projects their billing to month-end at the
              current daily rate. <b>Provider</b> = what you actually pay (the full fixed platform,
              billed whether or not customers are active, + all AI usage). The gap between the top of
              the customers bar and the provider bar is the platform capacity not covered by customers.
            </Text>
            {chartMonths.length === 0 ? (
              <Text size={200} italic>
                No cost recorded yet.
              </Text>
            ) : (
              <>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.swatchClients} /> Billable to customers (so far)
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.swatchProjected} /> Projected to month-end
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.swatchProvider} /> Provider actual spend
                  </span>
                </div>
                <div className={styles.chart}>
                  {chartMonths.map((m) => {
                    const billable = m.total_cost;
                    const provider = providerSpend(m);
                    const projectedBillable =
                      projection && projection.month === m.month
                        ? projection.projectedTotal
                        : billable;
                    const inc = Math.max(0, projectedBillable - billable);
                    return (
                      <div key={m.month} className={styles.barCol}>
                        <div className={styles.barPair}>
                          <div
                            className={styles.barUnit}
                            title={`Billable to customers: now ${money(billable, currency)} → projected month-end ${money(
                              projectedBillable,
                              currency
                            )} (+${money(inc, currency)})`}
                          >
                            <span className={styles.barValue}>{money(projectedBillable, currency)}</span>
                            <div className={styles.barStack}>
                              {inc > 0 && (
                                <div
                                  className={styles.barProjected}
                                  style={{ height: `${Math.round((inc / maxMonth) * 130)}px` }}
                                />
                              )}
                              <div
                                className={styles.bar}
                                style={{
                                  height: `${Math.round((billable / maxMonth) * 130)}px`,
                                  borderTopLeftRadius: inc > 0 ? 0 : undefined,
                                  borderTopRightRadius: inc > 0 ? 0 : undefined,
                                }}
                              />
                            </div>
                          </div>
                          <div
                            className={styles.barUnit}
                            title={`Provider actual spend: ${money(provider, currency)} (fixed platform ${money(
                              infraMonthly,
                              currency
                            )} + AI usage ${smallMoney(
                              (m.token_cost || 0) + (m.embedding_cost ?? 0) + (m.agentic_cost ?? 0),
                              currency
                            )})`}
                          >
                            <span className={styles.barValue}>{money(provider, currency)}</span>
                            <div
                              className={styles.barProvider}
                              style={{ height: `${Math.round((provider / maxMonth) * 130)}px` }}
                            />
                          </div>
                        </div>
                        <span className={styles.barLabel}>{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          {projection && (
            <Card className={styles.monthCard} style={{ order: 4 }}>
              <div className={styles.monthHead}>
                <Text weight="semibold">End-of-month projection · {projection.month}</Text>
                <Text weight="semibold">{money(projection.projectedTotal, currency)}</Text>
              </div>
              <Text size={200} italic>
                Open customers: what they've spent so far <b>plus</b> the {projection.remainingDays}{" "}
                day(s) left in the month at their current daily rate; suspended/closed ones are frozen
                at today's cost.
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
            <Card key={m.month} className={styles.monthCard} style={{ order: 2 }}>
              <div className={styles.monthHead}>
                <Text weight="semibold">{m.month}</Text>
                <Text weight="semibold">{money(m.total_cost, currency)}</Text>
              </div>
              {m.weights && (
                <Text size={200} italic>
                  Fixed shared-platform cost split by tokens {Math.round(m.weights.tokens * 100)}% ·
                  calls {Math.round(m.weights.calls * 100)}% · documents{" "}
                  {Math.round(m.weights.documents * 100)}% (then pro-rated by each customer's active
                  days). AI usage — tokens, embeddings, agentic — is billed directly to the customer,
                  not weighted.
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
                    <TableHeaderCell>Agentic</TableHeaderCell>
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
                      <TableCell title={`${(c.agentic_tokens ?? 0).toLocaleString()} planning tokens`}>
                        {(c.agentic_tokens ?? 0) > 0 ? (
                          <>
                            {smallMoney(c.agentic_cost ?? 0, currency)}{" "}
                            <Badge appearance="tint" color="brand" size="small">
                              RAG
                            </Badge>
                          </>
                        ) : (
                          smallMoney(c.agentic_cost ?? 0, currency)
                        )}
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
