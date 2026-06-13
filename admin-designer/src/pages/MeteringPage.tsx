import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Text,
  Input,
  Spinner,
  MessageBar,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Search24Regular } from "@fluentui/react-icons";
import { api, Metering, MeteringDay, Tenant } from "../api";

const CUSTOMER_PAGE_SIZE = 8;
const ALL_ORG = "__all__";
type Granularity = "daily" | "weekly" | "monthly";
type Metric = "tokens" | "calls";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "860px" },
  stats: { display: "flex", gap: "16px" },
  stat: { padding: "16px", flexGrow: 1, textAlign: "center" },
  customerList: {
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
  },
  customerItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  customerItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  pager: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
  chartCard: { padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  chartHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  controls: { display: "flex", gap: "12px", flexWrap: "wrap" },
  segmented: { display: "flex", gap: "4px" },
  chart: { display: "flex", alignItems: "flex-end", gap: "8px", height: "180px", paddingTop: "8px" },
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
    maxWidth: "42px",
    borderRadius: "6px 6px 0 0",
    background: "linear-gradient(180deg, #00A8A8 0%, #138DDE 60%, #4F6BFF 100%)",
    transition: "height 120ms ease",
  },
  barLabel: { fontSize: "11px", color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" },
  barValue: { fontSize: "11px", color: tokens.colorNeutralForeground2 },
});

interface Bucket {
  label: string;
  tokens: number;
  calls: number;
}

/** ISO week key (YYYY-Www) for a Date in UTC. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function aggregate(days: MeteringDay[], g: Granularity): Bucket[] {
  if (g === "daily") {
    return days.map((d) => ({ label: d.date.slice(5), tokens: d.tokens, calls: d.calls }));
  }
  const map = new Map<string, Bucket>();
  for (const d of days) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const key = g === "weekly" ? isoWeekKey(date) : d.date.slice(0, 7);
    const label = g === "weekly" ? key.slice(5) : key;
    const b = map.get(key) || { label, tokens: 0, calls: 0 };
    b.tokens += d.tokens;
    b.calls += d.calls;
    map.set(key, b);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

export function MeteringPage() {
  const styles = useStyles();
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [orgId, setOrgId] = useState("");
  const [data, setData] = useState<Metering | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [metric, setMetric] = useState<Metric>("tokens");

  // Customer picker (searchable + paginated), mirrors InstancesPage.
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(0);

  useEffect(() => {
    api
      .listCustomers()
      .then((c) => {
        setCustomers(c);
        setOrgId(ALL_ORG); // default to the aggregate "All customers" view
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    setErr("");

    if (orgId === ALL_ORG) {
      // Aggregate every customer's metering into one combined summary.
      Promise.all(customers.map((c) => api.metering(c.org_id).catch(() => null)))
        .then((all) => {
          const valid = all.filter((m): m is Metering => !!m);
          const byInstance: Record<string, { calls: number; tokens: number }> = {};
          const byDayMap: Record<string, { calls: number; tokens: number }> = {};
          let calls = 0;
          let totalTokens = 0;
          for (const m of valid) {
            calls += m.calls || 0;
            totalTokens += m.total_tokens || 0;
            for (const [k, v] of Object.entries(m.by_instance || {})) {
              const b = (byInstance[k] = byInstance[k] || { calls: 0, tokens: 0 });
              b.calls += v.calls;
              b.tokens += v.tokens;
            }
            for (const d of m.by_day || []) {
              const b = (byDayMap[d.date] = byDayMap[d.date] || { calls: 0, tokens: 0 });
              b.calls += d.calls;
              b.tokens += d.tokens;
            }
          }
          const by_day = Object.entries(byDayMap)
            .map(([date, v]) => ({ date, calls: v.calls, tokens: v.tokens }))
            .sort((a, b) => a.date.localeCompare(b.date));
          setData({ calls, total_tokens: totalTokens, by_instance: byInstance, by_day });
        })
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
      return;
    }

    api
      .metering(orgId)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [orgId, customers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.org_id.toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const totalCustomerPages = Math.max(1, Math.ceil(filteredCustomers.length / CUSTOMER_PAGE_SIZE));
  const pagedCustomers = filteredCustomers.slice(
    customerPage * CUSTOMER_PAGE_SIZE,
    customerPage * CUSTOMER_PAGE_SIZE + CUSTOMER_PAGE_SIZE
  );

  const buckets = useMemo(() => aggregate(data?.by_day || [], granularity), [data, granularity]);
  const maxValue = Math.max(1, ...buckets.map((b) => (metric === "tokens" ? b.tokens : b.calls)));

  return (
    <div className={styles.wrap}>
      <Text weight="semibold" size={500}>
        Customers
      </Text>
      <Input
        placeholder="Search customers by name or ID…"
        contentBefore={<Search24Regular />}
        value={customerSearch}
        onChange={(_, d) => {
          setCustomerSearch(d.value);
          setCustomerPage(0);
        }}
      />
      <div className={styles.customerList}>
        <div
          className={
            orgId === ALL_ORG
              ? `${styles.customerItem} ${styles.customerItemActive}`
              : styles.customerItem
          }
          onClick={() => setOrgId(ALL_ORG)}
        >
          <div>
            <Text weight={orgId === ALL_ORG ? "semibold" : "regular"}>All customers</Text>
          </div>
          <Text size={100}>total</Text>
        </div>
        {pagedCustomers.map((c) => (
          <div
            key={c.org_id}
            className={
              c.org_id === orgId
                ? `${styles.customerItem} ${styles.customerItemActive}`
                : styles.customerItem
            }
            onClick={() => setOrgId(c.org_id)}
          >
            <div>
              <Text weight={c.org_id === orgId ? "semibold" : "regular"}>{c.name}</Text>
            </div>
            <Text size={100}>{c.tier}</Text>
          </div>
        ))}
        {!pagedCustomers.length && (
          <div className={styles.customerItem} style={{ cursor: "default" }}>
            <Text size={200} italic>
              No customers match “{customerSearch}”.
            </Text>
          </div>
        )}
      </div>
      {totalCustomerPages > 1 && (
        <div className={styles.pager}>
          <Button
            size="small"
            disabled={customerPage === 0}
            onClick={() => setCustomerPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Text size={200}>
            Page {customerPage + 1} / {totalCustomerPages}
          </Text>
          <Button
            size="small"
            disabled={customerPage >= totalCustomerPages - 1}
            onClick={() => setCustomerPage((p) => Math.min(totalCustomerPages - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      )}

      {loading && <Spinner label="Loading…" />}
      {err && <MessageBar intent="error">{err}</MessageBar>}

      {data && (
        <>
          <div className={styles.stats}>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {data.calls}
              </Text>
              <div>
                <Text size={200}>total calls</Text>
              </div>
            </Card>
            <Card className={styles.stat}>
              <Text size={700} weight="bold">
                {data.total_tokens.toLocaleString()}
              </Text>
              <div>
                <Text size={200}>total tokens</Text>
              </div>
            </Card>
          </div>

          <Card className={styles.chartCard}>
            <div className={styles.chartHead}>
              <Text weight="semibold">
                {metric === "tokens" ? "Token consumption" : "Call volume"}
              </Text>
              <div className={styles.controls}>
                <div className={styles.segmented}>
                  {(["tokens", "calls"] as Metric[]).map((m) => (
                    <Button
                      key={m}
                      size="small"
                      appearance={metric === m ? "primary" : "secondary"}
                      onClick={() => setMetric(m)}
                    >
                      {m === "tokens" ? "Tokens" : "Calls"}
                    </Button>
                  ))}
                </div>
                <div className={styles.segmented}>
                  {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
                    <Button
                      key={g}
                      size="small"
                      appearance={granularity === g ? "primary" : "secondary"}
                      onClick={() => setGranularity(g)}
                    >
                      {g === "daily" ? "Daily" : g === "weekly" ? "Weekly" : "Monthly"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {buckets.length === 0 ? (
              <Text size={200} italic>
                No usage recorded yet.
              </Text>
            ) : (
              <div className={styles.chart}>
                {buckets.map((b, i) => {
                  const value = metric === "tokens" ? b.tokens : b.calls;
                  return (
                    <div
                      key={i}
                      className={styles.barCol}
                      title={`${b.tokens.toLocaleString()} tokens · ${b.calls} calls`}
                    >
                      <span className={styles.barValue}>{value.toLocaleString()}</span>
                      <div
                        className={styles.bar}
                        style={{ height: `${Math.round((value / maxValue) * 130)}px` }}
                      />
                      <span className={styles.barLabel}>{b.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <Text weight="semibold">Usage by instance</Text>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Instance</TableHeaderCell>
                  <TableHeaderCell>Calls</TableHeaderCell>
                  <TableHeaderCell>Tokens</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.by_instance).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>
                      <code>{k}</code>
                    </TableCell>
                    <TableCell>{v.calls}</TableCell>
                    <TableCell>{v.tokens.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(data.by_instance).length === 0 && (
                  <TableRow>
                    <TableCell>No usage yet</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
