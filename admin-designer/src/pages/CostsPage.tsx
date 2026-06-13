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
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(n);
    } catch {
      return `${n.toFixed(4)} ${currency}`;
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

export function CostsPage() {
  const styles = useStyles();
  const [data, setData] = useState<CostSummary | null>(null);
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .costs()
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

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

  const currency = data?.currency || "USD";
  const maxMonth = useMemo(
    () => Math.max(1, ...(data?.by_month || []).map((m) => m.total_cost)),
    [data]
  );
  // Chart shows oldest → newest (by_month arrives newest-first).
  const chartMonths = useMemo(() => [...(data?.by_month || [])].reverse(), [data]);

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
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Tokens</TableHeaderCell>
                    <TableHeaderCell>Calls</TableHeaderCell>
                    <TableHeaderCell>Documents</TableHeaderCell>
                    <TableHeaderCell>Active days</TableHeaderCell>
                    <TableHeaderCell>Infra share</TableHeaderCell>
                    <TableHeaderCell>Token cost</TableHeaderCell>
                    <TableHeaderCell>Infra cost</TableHeaderCell>
                    <TableHeaderCell>Total</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.clients.map((c) => (
                    <TableRow key={c.org_id}>
                      <TableCell>
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
