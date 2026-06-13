import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  Input,
  Label,
  Dropdown,
  Option,
  Badge,
  Spinner,
  MessageBar,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  makeStyles,
} from "@fluentui/react-components";
import { Delete24Regular } from "@fluentui/react-icons";
import { api, Tenant } from "../api";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  card: { padding: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
});

const EMPTY = {
  org_id: "",
  name: "",
  tier: "starter" as const,
  monthly_token_quota: 1_000_000,
  branding: { product_name: "", primary_color: "#5B5FC7", logo_url: "/logo.svg", tagline: "" },
};

// Default monthly token allowance per tier. Selecting a tier prefills this
// (the admin can still override the number manually).
const TIER_QUOTAS: Record<string, number> = {
  free: 100_000,
  starter: 1_000_000,
  pro: 5_000_000,
};

export function CustomersPage() {
  const styles = useStyles();
  const [items, setItems] = useState<Tenant[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<any>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [toDelete, setToDelete] = useState<Tenant | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const tenants = await api.listCustomers();
      setItems(tenants);
      // Fetch instance counts so we know which customers are safe to delete.
      const pairs = await Promise.all(
        tenants.map(async (t) => {
          try {
            const insts = await api.listInstances(t.org_id);
            return [t.org_id, insts.length] as const;
          } catch {
            return [t.org_id, 0] as const;
          }
        })
      );
      setCounts(Object.fromEntries(pairs));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setErr("");
    try {
      await api.saveCustomer(draft);
      setDraft(EMPTY);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setErr("");
    try {
      await api.deleteCustomer(toDelete.org_id);
      setToDelete(null);
      if (draft.org_id === toDelete.org_id) setDraft(EMPTY);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function toggleEnabled(t: Tenant) {
    setErr("");
    try {
      await api.saveCustomer({ ...t, enabled: !(t.enabled ?? true) });
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className={styles.grid}>
      <div className={styles.list}>
        <Text weight="semibold" size={500}>
          Customers
        </Text>
        {loading && <Spinner label="Loading…" />}
        {err && <MessageBar intent="error">{err}</MessageBar>}
        {items.map((t) => (
          <Card key={t.org_id} className={styles.card}>
            <CardHeader
              header={
                <div className={styles.row}>
                  <Text weight="semibold">{t.name}</Text>
                  <Badge appearance="tint">{t.tier}</Badge>
                  {t.enabled === false && (
                    <Badge appearance="filled" color="warning">
                      disabled
                    </Badge>
                  )}
                </div>
              }
              description={
                <Text size={200}>
                  org_id: <code>{t.org_id}</code> · index: <code>{t.search_index}</code>
                </Text>
              }
            />
            <Text size={200}>quota: {t.monthly_token_quota.toLocaleString()} tokens / month</Text>
            <div className={styles.row}>
              <Button size="small" onClick={() => setDraft(t)}>
                Edit
              </Button>
              <Button
                size="small"
                appearance="secondary"
                onClick={() => toggleEnabled(t)}
                title={
                  t.enabled === false
                    ? "Re-enable: customer becomes visible in the customer app"
                    : "Disable: customer is hidden from the customer app"
                }
              >
                {t.enabled === false ? "Enable" : "Disable"}
              </Button>
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete24Regular />}
                disabled={(counts[t.org_id] ?? 0) > 0}
                title={
                  (counts[t.org_id] ?? 0) > 0
                    ? "Remove all instances before deleting this customer"
                    : "Delete customer"
                }
                onClick={() => setToDelete(t)}
              >
                Delete
              </Button>
              {(counts[t.org_id] ?? 0) > 0 && (
                <Text size={100} style={{ color: "#8a6d00" }}>
                  {counts[t.org_id]} instance(s) attached
                </Text>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className={styles.card}>
        <Text weight="semibold" size={500}>
          {items.find((i) => i.org_id === draft.org_id) ? "Edit customer" : "Onboard customer"}
        </Text>
        <Text size={200}>Saving auto-creates the per-customer Search index kb-&#123;org_id&#125;.</Text>
        <div className={styles.form}>
          <Label>Customer ID (used at sign-in &amp; for data isolation — cannot be changed later)</Label>
          <Input value={draft.org_id} onChange={(_, d) => setDraft({ ...draft, org_id: d.value })} />
          <Label>Display name</Label>
          <Input value={draft.name} onChange={(_, d) => setDraft({ ...draft, name: d.value })} />
          <Label>Tier</Label>
          <Dropdown
            selectedOptions={[draft.tier]}
            value={draft.tier}
            onOptionSelect={(_, d) => {
              const tier = d.optionValue as string;
              setDraft({
                ...draft,
                tier,
                monthly_token_quota: TIER_QUOTAS[tier] ?? draft.monthly_token_quota,
              });
            }}
          >
            <Option value="free">free</Option>
            <Option value="starter">starter</Option>
            <Option value="pro">pro</Option>
          </Dropdown>
          <Label>Monthly token quota</Label>
          <Input
            type="number"
            value={String(draft.monthly_token_quota)}
            onChange={(_, d) => setDraft({ ...draft, monthly_token_quota: Number(d.value) })}
          />
          <Label>Brand: product name</Label>
          <Input
            value={draft.branding.product_name}
            onChange={(_, d) =>
              setDraft({ ...draft, branding: { ...draft.branding, product_name: d.value } })
            }
          />
          <Label>Brand: primary color</Label>
          <Input
            value={draft.branding.primary_color}
            onChange={(_, d) =>
              setDraft({ ...draft, branding: { ...draft.branding, primary_color: d.value } })
            }
          />
          <Label>Brand: tagline</Label>
          <Input
            value={draft.branding.tagline}
            onChange={(_, d) =>
              setDraft({ ...draft, branding: { ...draft.branding, tagline: d.value } })
            }
          />
          <div className={styles.row}>
            <Button appearance="primary" onClick={save} disabled={!draft.org_id || !draft.name}>
              Save
            </Button>
            <Button appearance="secondary" onClick={() => setDraft(EMPTY)}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!toDelete} onOpenChange={(_, d) => !d.open && setToDelete(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogContent>
              <Text>
                You are about to permanently delete{" "}
                <strong>{toDelete?.name}</strong> (<code>{toDelete?.org_id}</code>) and its
                empty Search index. This action cannot be undone.
              </Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={deleting}>
                  Cancel
                </Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={confirmDelete} disabled={deleting}>
                {deleting ? <Spinner size="tiny" /> : "Delete customer"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
