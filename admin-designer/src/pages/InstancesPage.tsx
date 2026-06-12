import { useEffect, useState } from "react";
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
  Field,
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
import { api, Instance, Tenant, Template } from "../api";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  card: { padding: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" },
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

  // Knowledge upload
  const [kInstanceId, setKInstanceId] = useState("");
  const [kTitle, setKTitle] = useState("");
  const [kFile, setKFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");

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
    if (!kFile || !kTitle || !kInstanceId) return;
    setUploadMsg("");
    try {
      const r = await api.uploadKnowledge(orgId, kInstanceId, kTitle, "upload", kFile);
      setUploadMsg(`Indexed doc ${r.id}`);
      setKTitle("");
      setKFile(null);
    } catch (e: any) {
      setUploadMsg("Error: " + e.message);
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

  return (
    <div className={styles.grid}>
      <div className={styles.list}>
        <Field label="Customer">
          <Dropdown
            value={customers.find((c) => c.org_id === orgId)?.name || ""}
            selectedOptions={[orgId]}
            onOptionSelect={(_, d) => setOrgId(d.optionValue || "")}
          >
            {customers.map((c) => (
              <Option key={c.org_id} value={c.org_id}>
                {c.name}
              </Option>
            ))}
          </Dropdown>
        </Field>

        <Text weight="semibold" size={500}>
          Instances for {orgId || "—"}
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
            <Label>Title</Label>
            <Input value={kTitle} onChange={(_, d) => setKTitle(d.value)} />
            <Label>File (.txt / .md)</Label>
            <input
              type="file"
              accept=".txt,.md,.json"
              onChange={(e) => setKFile(e.target.files?.[0] || null)}
            />
            <Button
              appearance="primary"
              onClick={upload}
              disabled={!orgId || !kInstanceId || !kFile || !kTitle}
            >
              Upload &amp; index
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
