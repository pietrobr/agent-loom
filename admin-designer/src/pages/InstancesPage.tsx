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
  Switch,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  makeStyles,
  tokens,
  OverlayDrawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
} from "@fluentui/react-components";
import {
  Delete24Regular,
  Edit24Regular,
  Search24Regular,
  Open16Regular,
  Wrench20Regular,
  Add20Filled,
  Dismiss24Regular,
  DocumentArrowUp20Regular,
} from "@fluentui/react-icons";
import { api, AgentInfo, Instance, Tenant, Template } from "../api";

const CUSTOMER_PAGE_SIZE = 8;

const useStyles = makeStyles({
  layout: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "860px" },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "16px" },
  card: { padding: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  toolbar: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" },
  cardEditing: {
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: "-1px",
  },
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
  agentPanel: {
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  toolRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  portalLink: { display: "inline-flex", alignItems: "center", gap: "4px" },
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
  const [suggested, setSuggested] = useState("");
  const [model, setModel] = useState("");
  const [assigning, setAssigning] = useState(false);
  // When set, the form edits this existing instance instead of creating a new one.
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // Slide-in panels
  const [assignOpen, setAssignOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Per-instance Foundry agent panel (portal link + tools), lazy-loaded.
  const [agentOpen, setAgentOpen] = useState<Record<string, boolean>>({});
  const [agentInfo, setAgentInfo] = useState<Record<string, AgentInfo>>({});
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({});

  async function loadAgent(instanceId: string) {
    setAgentBusy((b) => ({ ...b, [instanceId]: true }));
    try {
      const info = await api.getInstanceAgent(orgId, instanceId);
      setAgentInfo((m) => ({ ...m, [instanceId]: info }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAgentBusy((b) => ({ ...b, [instanceId]: false }));
    }
  }

  function toggleAgentPanel(instanceId: string) {
    const open = !agentOpen[instanceId];
    setAgentOpen((m) => ({ ...m, [instanceId]: open }));
    if (open && !agentInfo[instanceId]) loadAgent(instanceId);
  }

  async function toggleTool(instanceId: string, key: string, enabled: boolean) {
    setAgentBusy((b) => ({ ...b, [instanceId]: true }));
    try {
      await api.toggleInstanceAgentTool(orgId, instanceId, key, enabled);
      await loadAgent(instanceId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAgentBusy((b) => ({ ...b, [instanceId]: false }));
    }
  }

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
    if (assigning) return;
    setErr("");
    setAssigning(true);
    try {
      const questions = suggested
        .split("\n")
        .map((q) => q.trim())
        .filter(Boolean);
      await api.saveInstance(orgId, {
        ...(editingId ? { id: editingId } : {}),
        template_id: templateId,
        display_name: displayName,
        overrides: addendum ? { instructions_addendum: addendum } : {},
        suggested_questions: questions,
        ...(model ? { model } : {}),
      });
      resetForm();
      await loadInstances(orgId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAssigning(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setTemplateId("");
    setDisplayName("");
    setAddendum("");
    setSuggested("");
    setModel("");
    setAssignOpen(false);
  }

  function openAssignNew() {
    setEditingId(null);
    setTemplateId("");
    setDisplayName("");
    setAddendum("");
    setSuggested("");
    setModel("");
    setAssignOpen(true);
  }

  function editInstance(i: Instance) {
    setEditingId(i.id);
    setTemplateId(i.template_id);
    setDisplayName(i.display_name);
    setAddendum(String(i.overrides?.instructions_addendum || ""));
    setSuggested((i.suggested_questions || []).join("\n"));
    setModel(i.model || "");
    setAssignOpen(true);
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
    <>
      <div className={styles.layout}>
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

        <div className={styles.header}>
          <Text weight="semibold" size={500}>
            Instances for {customers.find((c) => c.org_id === orgId)?.name || orgId || "—"}
          </Text>
          <div className={styles.toolbar}>
            <Button
              appearance="primary"
              icon={<Add20Filled />}
              disabled={!orgId}
              onClick={openAssignNew}
            >
              Assign template
            </Button>
            <Button
              icon={<DocumentArrowUp20Regular />}
              disabled={!orgId || !instances.length}
              onClick={() => setUploadOpen(true)}
            >
              Upload knowledge
            </Button>
          </div>
        </div>
        {loading && <Spinner label="Loading…" />}
        {err && <MessageBar intent="error">{err}</MessageBar>}
        {instances.map((i) => (
          <Card
            key={i.id}
            className={
              i.id === editingId ? `${styles.card} ${styles.cardEditing}` : styles.card
            }
          >
            <div className={styles.cardTop}>
              <CardHeader
                header={<Text weight="semibold">{i.display_name}</Text>}
                description={
                  <Text size={200}>
                    template: <code>{i.template_id}</code>
                    {i.model ? <> · model: <code>{i.model}</code></> : null} · agent:{" "}
                    {i.foundry_agent_id ? <code>{i.foundry_agent_id}</code> : <em>pending</em>}
                  </Text>
                }
              />
              <div className={styles.row}>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Edit24Regular />}
                  aria-label="Edit instance"
                  onClick={() => editInstance(i)}
                >
                  Edit
                </Button>
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
            </div>
            {i.overrides?.instructions_addendum && (
              <Text size={200} italic>
                {String(i.overrides.instructions_addendum)}
              </Text>
            )}
            {!!i.suggested_questions?.length && (
              <Text size={200}>
                Suggested: {i.suggested_questions.join(" · ")}
              </Text>
            )}
            {i.foundry_agent_id && (
              <div className={styles.row}>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Wrench20Regular />}
                  onClick={() => toggleAgentPanel(i.id)}
                >
                  {agentOpen[i.id] ? "Hide agent" : "Agent & tools"}
                </Button>
              </div>
            )}
            {agentOpen[i.id] && (
              <div className={styles.agentPanel}>
                {agentBusy[i.id] && !agentInfo[i.id] ? (
                  <Spinner size="tiny" label="Loading agent…" />
                ) : agentInfo[i.id] ? (
                  <>
                    {agentInfo[i.id].portal_url ? (
                      <a
                        className={styles.portalLink}
                        href={agentInfo[i.id].portal_url || "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Open16Regular /> Open agent in Azure AI Foundry portal
                      </a>
                    ) : (
                      <Text size={200} italic>
                        Foundry portal link not configured.
                      </Text>
                    )}
                    <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                      Agent: <code>{agentInfo[i.id].name}</code>
                    </Text>
                    <Text size={200}>
                      Tools{agentInfo[i.id].version ? ` · agent v${agentInfo[i.id].version}` : ""}:
                    </Text>
                    {agentInfo[i.id].tools.length === 0 ? (
                      <Text size={200} italic>
                        No tools configured on this agent.
                      </Text>
                    ) : (
                      agentInfo[i.id].tools.map((t) => {
                        const key = String((t as any).key ?? t.type ?? "");
                        const label = t.name || t.type || "tool";
                        return (
                          <div key={key} className={styles.toolRow}>
                            <Text size={200}>
                              {label}
                              {t.type && t.name ? <> <code>{t.type}</code></> : null}
                            </Text>
                            <Switch
                              checked={t.enabled}
                              disabled={agentBusy[i.id]}
                              onChange={(_, d) => toggleTool(i.id, key, d.checked)}
                            />
                          </div>
                        );
                      })
                    )}
                  </>
                ) : null}
              </div>
            )}
          </Card>
        ))}
      </div>

      <OverlayDrawer position="end" open={assignOpen} onOpenChange={(_, d) => setAssignOpen(d.open)} size="medium">
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button appearance="subtle" aria-label="Close" icon={<Dismiss24Regular />} onClick={() => setAssignOpen(false)} />
            }
          >
            {editingId ? "Edit instance" : "Assign template"}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          <Text size={200}>
            {editingId
              ? "Update this instance's display name, guidance and suggested questions. The template and its Foundry agent stay the same."
              : "Creates a dedicated Foundry agent for this customer from the chosen template blueprint."}
          </Text>
          <div className={styles.form}>
            <Label>Template</Label>
            <Dropdown
              value={templates.find((t) => t.id === templateId)?.name || ""}
              selectedOptions={[templateId]}
              disabled={!!editingId}
              onOptionSelect={(_, d) => {
                const id = d.optionValue || "";
                setTemplateId(id);
                // Default the model to the template's first enabled model.
                const tpl = templates.find((t) => t.id === id);
                const allowed = tpl?.allowed_models || [];
                setModel(allowed.includes(model) ? model : allowed[0] || "");
              }}
            >
              {templates.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Dropdown>
            {(() => {
              const tpl = templates.find((t) => t.id === templateId);
              const allowed = tpl?.allowed_models || [];
              if (allowed.length === 0) return null;
              return (
                <>
                  <Label>Model (only those enabled by the template)</Label>
                  <Dropdown
                    value={model}
                    selectedOptions={[model]}
                    onOptionSelect={(_, d) => setModel(d.optionValue || "")}
                  >
                    {allowed.map((m) => (
                      <Option key={m} value={m}>
                        {m}
                      </Option>
                    ))}
                  </Dropdown>
                </>
              );
            })()}
            <Label>Display name</Label>
            <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
            <Label>Instructions addendum (customer override)</Label>
            <Textarea
              resize="vertical"
              value={addendum}
              onChange={(_, d) => setAddendum(d.value)}
            />
            <Label>Suggested questions (one per line — shown as chips in the customer chat)</Label>
            <Textarea
              resize="vertical"
              placeholder={"What is your refund policy?\nHow do I change my booking?"}
              value={suggested}
              onChange={(_, d) => setSuggested(d.value)}
            />
            <div className={styles.row}>
              <Button
                appearance="primary"
                onClick={assign}
                disabled={!orgId || !templateId || !displayName || assigning}
              >
                {assigning ? <Spinner size="tiny" /> : editingId ? "Save changes" : "Assign"}
              </Button>
              {editingId && (
                <Button appearance="secondary" onClick={resetForm} disabled={assigning}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </DrawerBody>
      </OverlayDrawer>

      <OverlayDrawer position="end" open={uploadOpen} onOpenChange={(_, d) => setUploadOpen(d.open)} size="medium">
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button appearance="subtle" aria-label="Close" icon={<Dismiss24Regular />} onClick={() => setUploadOpen(false)} />
            }
          >
            Upload knowledge (private)
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
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
        </DrawerBody>
      </OverlayDrawer>

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
    </>
  );
}
