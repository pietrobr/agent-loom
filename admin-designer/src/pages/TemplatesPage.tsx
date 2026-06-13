import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  Input,
  Textarea,
  Dropdown,
  Option,
  Label,
  Badge,
  Spinner,
  makeStyles,
  tokens,
  MessageBar,
  OverlayDrawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
} from "@fluentui/react-components";
import { Add20Filled, Dismiss24Regular, Edit20Regular, Delete20Regular } from "@fluentui/react-icons";
import { api, Template } from "../api";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "760px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "16px" },
  card: { padding: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
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
});

const EMPTY: Partial<Template> = {
  name: "",
  description: "",
  category: "general",
  model: "gpt-4o-mini",
  allowed_models: [],
  instructions: "",
  parameters: [],
  status: "draft",
};

export function TemplatesPage() {
  const styles = useStyles();
  const [items, setItems] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Partial<Template>>(EMPTY);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [open, setOpen] = useState(false);

  function openNew() {
    setDraft(EMPTY);
    setOpen(true);
  }
  function openEdit(t: Template) {
    setDraft(t);
    setOpen(true);
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [tpls, foundryModels] = await Promise.all([
        api.listTemplates(),
        api.listFoundryModels().catch(() => [] as string[]),
      ]);
      setItems(tpls);
      setModels(foundryModels);
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
      await api.saveTemplate(draft);
      setDraft(EMPTY);
      setOpen(false);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <>
      <div className={styles.list}>
        <div className={styles.header}>
          <Text weight="semibold" size={500}>
            Catalog templates
          </Text>
          <Button appearance="primary" icon={<Add20Filled />} onClick={openNew}>
            New template
          </Button>
        </div>
        {loading && <Spinner label="Loading…" />}
        {err && <MessageBar intent="error">{err}</MessageBar>}
        {!loading && items.length === 0 && (
          <div className={styles.empty}>
            <Text size={400} weight="semibold">No templates yet</Text>
            <Text size={200}>Create a reusable agent blueprint to assign to customers.</Text>
            <Button appearance="primary" icon={<Add20Filled />} onClick={openNew}>
              New template
            </Button>
          </div>
        )}
        {items.map((t) => (
          <Card key={t.id} className={styles.card}>
            <CardHeader
              header={
                <div className={styles.row}>
                  <Text weight="semibold">{t.name}</Text>
                  <Badge appearance="tint" color={t.status === "published" ? "success" : "warning"}>
                    {t.status}
                  </Badge>
                </div>
              }
              description={<Text size={200}>{t.description}</Text>}
            />
            <Text size={200}>
              category: {t.category} · models:{" "}
              {t.allowed_models?.length ? t.allowed_models.join(", ") : t.model} · a Foundry
              agent is created per customer when an instance is configured
            </Text>
            <div className={styles.row}>
              <Button size="small" icon={<Edit20Regular />} onClick={() => openEdit(t)}>
                Edit
              </Button>
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                onClick={async () => {
                  await api.deleteTemplate(t.id);
                  load();
                }}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <OverlayDrawer position="end" open={open} onOpenChange={(_, d) => setOpen(d.open)} size="medium">
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                aria-label="Close"
                icon={<Dismiss24Regular />}
                onClick={() => setOpen(false)}
              />
            }
          >
            {draft.id ? "Edit template" : "New template"}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          <div className={styles.form}>
          <Label>Name</Label>
          <Input value={draft.name || ""} onChange={(_, d) => setDraft({ ...draft, name: d.value })} />
          <Label>Description</Label>
          <Input
            value={draft.description || ""}
            onChange={(_, d) => setDraft({ ...draft, description: d.value })}
          />
          <Label>Category</Label>
          <Input
            value={draft.category || ""}
            onChange={(_, d) => setDraft({ ...draft, category: d.value })}
          />
          <Label>Enabled models (from Foundry — customers pick one of these)</Label>
          <Dropdown
            multiselect
            placeholder={models.length ? "Select model deployments…" : "No Foundry deployments found"}
            selectedOptions={draft.allowed_models || []}
            value={(draft.allowed_models || []).join(", ")}
            onOptionSelect={(_, d) => {
              const allowed = d.selectedOptions;
              setDraft({
                ...draft,
                allowed_models: allowed,
                // keep a sensible default model for backwards compatibility
                model: allowed.includes(draft.model || "") ? draft.model : allowed[0] || draft.model,
              });
            }}
          >
            {models.map((m) => (
              <Option key={m} value={m}>
                {m}
              </Option>
            ))}
          </Dropdown>
          {!!(draft.allowed_models && draft.allowed_models.length > 1) && (
            <>
              <Label>Default model</Label>
              <Dropdown
                value={draft.model || ""}
                selectedOptions={[draft.model || ""]}
                onOptionSelect={(_, d) => setDraft({ ...draft, model: d.optionValue || "" })}
              >
                {(draft.allowed_models || []).map((m) => (
                  <Option key={m} value={m}>
                    {m}
                  </Option>
                ))}
              </Dropdown>
            </>
          )}
          <Label>Instructions</Label>
          <Textarea
            resize="vertical"
            value={draft.instructions || ""}
            onChange={(_, d) => setDraft({ ...draft, instructions: d.value })}
          />
          <Label>Status</Label>
          <Dropdown
            value={draft.status}
            selectedOptions={[draft.status || "draft"]}
            onOptionSelect={(_, d) => setDraft({ ...draft, status: d.optionValue as any })}
          >
            <Option value="draft">draft</Option>
            <Option value="published">published</Option>
          </Dropdown>
          <div className={styles.row}>
            <Button appearance="primary" onClick={save} disabled={!draft.name}>
              Save
            </Button>
            <Button appearance="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          </div>
        </DrawerBody>
      </OverlayDrawer>
    </>
  );
}
