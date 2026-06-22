import { useEffect, useState } from "react";
import {
  Card,
  Text,
  Switch,
  Badge,
  Spinner,
  MessageBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { api, InfraConfig } from "../api";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" },
  card: { padding: "20px", display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" },
  desc: { color: tokens.colorNeutralForeground3, fontSize: "13px", lineHeight: "18px" },
  meta: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
});

export function InfraPage() {
  const styles = useStyles();
  const [cfg, setCfg] = useState<InfraConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getInfraConfig()
      .then(setCfg)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setErr("");
    try {
      const next = await api.setInfraConfig({ app_insights_enabled: enabled });
      setCfg(next);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleContent(enabled: boolean) {
    setSaving(true);
    setErr("");
    try {
      const next = await api.setInfraConfig({ gen_ai_content_recording: enabled });
      setCfg(next);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <Text size={600} weight="semibold">
        Infrastructure
      </Text>

      {err && <MessageBar intent="error">{err}</MessageBar>}
      {loading && <Spinner label="Loading…" />}

      {cfg && (
        <Card className={styles.card}>
          <div className={styles.row}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Text weight="semibold">Write traces to Application Insights</Text>
              <Text className={styles.desc}>
                Mirror request traces (Cosmos / Search / Foundry spans) to Azure
                Application Insights for monitoring, alerting and Foundry tracing.
                Turn off to stop ingestion and save costs — the in-app Tracing page
                keeps working regardless.
              </Text>
            </div>
            <Switch
              checked={cfg.app_insights_enabled}
              disabled={saving || !cfg.app_insights_wired}
              onChange={(_, d) => toggle(d.checked)}
            />
          </div>

          <div className={styles.meta}>
            <Badge
              appearance="filled"
              color={cfg.app_insights_enabled ? "success" : "informative"}
            >
              {cfg.app_insights_enabled ? "Writing" : "Disabled"}
            </Badge>
            {cfg.app_insights_wired ? (
              <Badge appearance="tint" color="success">
                Connection wired
              </Badge>
            ) : (
              <Badge appearance="tint" color="warning" title="No APPLICATIONINSIGHTS_CONNECTION_STRING">
                Not wired — deploy infra to enable
              </Badge>
            )}
          </div>

          {!cfg.app_insights_wired && (
            <MessageBar intent="warning">
              Application Insights is not connected yet. The toggle has no effect
              until the infrastructure injects the connection string (next deploy).
            </MessageBar>
          )}
        </Card>
      )}

      {cfg && (
        <Card className={styles.card}>
          <div className={styles.row}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Text weight="semibold">Record prompt &amp; response content</Text>
              <Text className={styles.desc}>
                Also capture the user prompt and the model's response text on GenAI
                traces (in addition to model and token metadata). Useful for
                debugging and evaluation. Off by default — prompts may contain
                personal data and increase Application Insights ingestion cost.
              </Text>
            </div>
            <Switch
              checked={cfg.gen_ai_content_recording}
              disabled={saving}
              onChange={(_, d) => toggleContent(d.checked)}
            />
          </div>
          <div className={styles.meta}>
            <Badge
              appearance="filled"
              color={cfg.gen_ai_content_recording ? "warning" : "informative"}
            >
              {cfg.gen_ai_content_recording ? "Recording content" : "Metadata only"}
            </Badge>
          </div>
          {cfg.gen_ai_content_recording && (
            <MessageBar intent="warning">
              Prompt and response text is being recorded on traces. Ensure this
              complies with your data-handling and privacy requirements.
            </MessageBar>
          )}
        </Card>
      )}
    </div>
  );
}
