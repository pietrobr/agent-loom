import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  Input,
  Textarea,
  Label,
  Dropdown,
  Option,
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
  tokens,
} from "@fluentui/react-components";
import { Delete24Regular, Search24Regular } from "@fluentui/react-icons";
import { api, Instance, Tenant, Template } from "../api";

const CUSTOMER_PAGE_SIZE = 8;

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  card: { padding: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" },
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
});

export function InstancesPage() {
  const styles = useStyles();
  const [customers, setCustomers] = useState<Tenant[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // New-instance draft
  const [templateId, setTemplateId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [addendum, setAddendum] = useState("");

  // Customer picker (searchable + paginated)
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(0);

  // Knowledge upload (supports multiple files)
  const [kInstanceId, setKInstanceId] = useState("");
  const [kFiles, setKFiles] = useState<File[]>([]);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  // Instance removal
  const [toDelete, setToDelete] = useState<Instance | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, t] = await Promise.all([api.listCustomers(), api.listTemplates()]);
        setCustomers(c);
        setTemplates(t);
        if (c.length && !orgId) setOrgId(c[0].org_id);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, []);

  async function loadInstances(id: string) {
    if (!id) return;
    setLoading(true);
    setErr("");
    try {
      const list = await api.listInstances(id);
      setInstances(list);
      // keep the upload target valid
      setKInstanceId((prev) =>
        list.some((i) => i.id === prev) ? prev : list[0]?.id || ""
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadInstances(orgId);
  }, [orgId]);

  async function assign() {
    setErr("");
    try {
      await api.saveInstance(orgId, {
        template_id: templateId,
        display_name: displayName,
        overrides: addendum ? { instructions_addendum: addendum } : {},
      });
      setTemplateId("");
      setDisplayName("");
      setAddendum("");
      await loadInstances(orgId);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function upload() {
    if (!kFiles.length || !kInstanceId) return;
    setUploadMsg("");
    setUploading(true);
    let ok = 0;
    const errors: string[] = [];
    try {
      for (const f of kFiles) {
        try {
          // Use the file name (without extension) as the document title.
          const title = f.name.replace(/\.[^.]+$/, "");
          await api.uploadKnowledge(orgId, kInstanceId, title, "upload", f);
          ok += 1;
        } catch (e: any) {
          errors.push(`${f.name}: ${e.message}`);
        }
      }
      setUploadMsg(
        errors.length
          ? `Indexed ${ok}/${kFiles.length}. Errors: ${errors.join("; ")}`
          : `Indexed ${ok} file(s).`
      );
      if (!errors.length) setKFiles([]);
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setErr("");
    try {
      await api.deleteInstance(orgId, toDelete.id);
      setToDelete(null);
      await loadInstances(orgId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  }

  // Customer search + pagination (client-side; the list is small in the MVP).
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

  return (
    <div className={styles.grid}>
      <div className={styles.list}>
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
                <div>
                  <Text size={100} font="monospace">{c.org_id}</Text>
                </div>
              </div>
              <Text size={100}>{c.tier}</Text>
            </div>
          ))}
          {!pagedCustomers.length && (
            <div className={styles.customerItem} style={{ cursor: "default" }}>
              <Text size={200} italic>No customers match “{customerSearch}”.</Text>
            </div>
          )}
        </div>
        {totalCustomerPages > 1 && (
          <div className={styles.pager}>
            <Button
              size="small"
              appearance="secondary"
              disabled={customerPage === 0}
              onClick={() => setCustomerPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Text size={200}>
              Page {customerPage + 1} / {totalCustomerPages} · {filteredCustomers.length} customer(s)
            </Text>
            <Button
              size="small"
              appearance="secondary"
              disabled={customerPage >= totalCustomerPages - 1}
              onClick={() => setCustomerPage((p) => Math.min(totalCustomerPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        )}

        <Text weight="semibold" size={500}>
          Instances for {customers.find((c) => c.org_id === orgId)?.name || orgId || "—"}
        </Text>
        {loading && <Spinner label="Loading…" />}
        {err && <MessageBar intent="error">{err}</MessageBar>}
        {instances.map((i) => (
          <Card key={i.id} className={styles.card}>
            <div className={styles.cardTop}>
              <CardHeader
                header={<Text weight="semibold">{i.display_name}</Text>}
                description={
                  <Text size={200}>
                    template: <code>{i.template_id}</code> · agent:{" "}
                    {i.foundry_agent_id ? <code>{i.foundry_agent_id}</code> : <em>pending</em>}
                  </Text>
                }
              />
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete24Regular />}
                aria-label="Remove instance"
                onClick={() => setToDelete(i)}
              >
                Remove
              </Button>
            </div>
            {i.overrides?.instructions_addendum && (
              <Text size={200} italic>
                {String(i.overrides.instructions_addendum)}
              </Text>
            )}
          </Card>
        ))}
      </div>

      <div className={styles.list}>
        <Card className={styles.card}>
          <Text weight="semibold" size={500}>
            Assign template
          </Text>
          <Text size={200}>
            Creates a dedicated Foundry agent for this customer from the chosen
            template blueprint.
          </Text>
          <div className={styles.form}>
            <Label>Template</Label>
            <Dropdown
              value={templates.find((t) => t.id === templateId)?.name || ""}
              selectedOptions={[templateId]}
              onOptionSelect={(_, d) => setTemplateId(d.optionValue || "")}
            >
              {templates.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Dropdown>
            <Label>Display name</Label>
            <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
            <Label>Instructions addendum (customer override)</Label>
            <Textarea
              resize="vertical"
              value={addendum}
              onChange={(_, d) => setAddendum(d.value)}
            />
            <Button appearance="primary" onClick={assign} disabled={!orgId || !templateId || !displayName}>
              Assign
            </Button>
          </div>
        </Card>

        <Card className={styles.card}>
          <Text weight="semibold" size={500}>
            Upload knowledge (private)
          </Text>
          <Text size={200}>
            Stored in a per-instance Blob folder and indexed into kb-{orgId}
            (scoped to the chosen instance). Removed when the instance is deleted.
            You can select multiple files — each file name becomes its document title.
          </Text>
          <div className={styles.form}>
            <Label>Instance</Label>
            <Dropdown
              value={instances.find((i) => i.id === kInstanceId)?.display_name || ""}
              selectedOptions={[kInstanceId]}
              onOptionSelect={(_, d) => setKInstanceId(d.optionValue || "")}
            >
              {instances.map((i) => (
                <Option key={i.id} value={i.id}>
                  {i.display_name}
                </Option>
              ))}
            </Dropdown>
            <Label>Files (.txt / .md / .json) — multiple allowed</Label>
            <input
              type="file"
              multiple
              accept=".txt,.md,.json"
              onChange={(e) => setKFiles(Array.from(e.target.files || []))}
            />
            {kFiles.length > 0 && (
              <Text size={200}>
                {kFiles.length} file(s) selected: {kFiles.map((f) => f.name).join(", ")}
              </Text>
            )}
            <Button
              appearance="primary"
              onClick={upload}
              disabled={!orgId || !kInstanceId || !kFiles.length || uploading}
            >
              {uploading ? <Spinner size="tiny" /> : `Upload & index ${kFiles.length || ""}`.trim()}
            </Button>
            {uploadMsg && <MessageBar intent="info">{uploadMsg}</MessageBar>}
          </div>
        </Card>
      </div>

      <Dialog open={!!toDelete} onOpenChange={(_, d) => !d.open && setToDelete(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Remove instance?</DialogTitle>
            <DialogContent>
              <Text>
                You are about to permanently remove{" "}
                <strong>{toDelete?.display_name}</strong> from <code>{orgId}</code>.
              </Text>
              <ul>
                <li>its dedicated Foundry agent will be deleted</li>
                <li>its knowledge base (indexed docs + blob folder) will be deleted</li>
              </ul>
              <Text>This action cannot be undone.</Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={deleting}>
                  Cancel
                </Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={confirmDelete} disabled={deleting}>
                {deleting ? <Spinner size="tiny" /> : "Delete instance + KB"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
