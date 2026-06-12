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
  makeStyles,
} from "@fluentui/react-components";
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

export function CustomersPage() {
  const styles = useStyles();
  const [items, setItems] = useState<Tenant[]>([]);
  const [draft, setDraft] = useState<any>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      setItems(await api.listCustomers());
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
          <Label>org_id (slug, immutable)</Label>
          <Input value={draft.org_id} onChange={(_, d) => setDraft({ ...draft, org_id: d.value })} />
          <Label>Display name</Label>
          <Input value={draft.name} onChange={(_, d) => setDraft({ ...draft, name: d.value })} />
          <Label>Tier</Label>
          <Dropdown
            selectedOptions={[draft.tier]}
            value={draft.tier}
            onOptionSelect={(_, d) => setDraft({ ...draft, tier: d.optionValue })}
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
    </div>
  );
}
