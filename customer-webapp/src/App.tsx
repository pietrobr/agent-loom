import { useEffect, useRef, useState } from "react";
import {
  Button,
  Textarea,
  Text,
  Dropdown,
  Option,
  Spinner,
  Badge,
  makeStyles,
  tokens,
  Avatar,
  MessageBar,
} from "@fluentui/react-components";
import { Send24Filled } from "@fluentui/react-icons";
import { brandGradient } from "./theme";
import {
  BrandingResponse,
  DemoCustomer,
  devLogin,
  fetchBranding,
  fetchDemoCustomers,
  getToken,
  setToken,
  streamChat,
} from "./api";

const useStyles = makeStyles({
  app: { display: "flex", flexDirection: "column", height: "100vh" },
  demoBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "6px 12px",
    backgroundColor: "#053B5E",
    color: "#EAFBFF",
    borderBottom: "2px solid #00A8A8",
    fontSize: "12px",
    fontWeight: 600,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 20px",
    color: "#fff",
  },
  logo: { height: "30px", width: "30px", color: "#fff" },
  spacer: { flexGrow: 1 },
  chat: {
    flexGrow: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    maxWidth: "70%",
    padding: "10px 14px",
    borderRadius: "14px 14px 2px 14px",
    color: "#fff",
  },
  bubbleBot: {
    alignSelf: "flex-start",
    maxWidth: "70%",
    padding: "10px 14px",
    borderRadius: "14px 14px 14px 2px",
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    whiteSpace: "pre-wrap",
  },
  composer: { display: "flex", gap: "8px", padding: "12px 20px", alignItems: "flex-end" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  starter: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    marginTop: "40px",
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    justifyContent: "center",
    maxWidth: "560px",
  },
  chip: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    fontSize: "13px",
    boxShadow: tokens.shadow2,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
});

interface Msg {
  role: "user" | "bot";
  text: string;
}

export function App() {
  const styles = useStyles();
  const [customers, setCustomers] = useState<DemoCustomer[]>([]);
  const [customer, setCustomer] = useState<DemoCustomer | null>(null);
  const [instanceId, setInstanceId] = useState<string>("");
  const [branding, setBranding] = useState<BrandingResponse | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [convId, setConvId] = useState<string | undefined>();
  const [lastUsage, setLastUsage] = useState<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Sign in (dev) + load branding whenever the customer changes.
  async function selectCustomer(c: DemoCustomer) {
    setErr("");
    setCustomer(c);
    setInstanceId(c.instances[0]?.id || "");
    setMessages([]);
    setConvId(undefined);
    setLastUsage(null);
    try {
      await devLogin(c.org_id);
      setBranding(await fetchBranding());
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // Load the real customer list (whatever exists in the backend) on mount.
  useEffect(() => {
    fetchDemoCustomers()
      .then((list) => {
        setCustomers(list);
        if (list.length) selectCustomer(list[0]);
        else setErr("No customers with an assigned instance yet. Create one in the Designer.");
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !instanceId) return;
    setInput("");
    setErr("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "bot", text: "" }]);

    let acc = "";
    await streamChat(
      { message: text, instance_id: instanceId, conversation_id: convId },
      {
        onMeta: (m) => m?.conversation_id && setConvId(m.conversation_id),
        onToken: (t) => {
          acc += t;
          setMessages((msgs) => {
            const copy = [...msgs];
            copy[copy.length - 1] = { role: "bot", text: acc };
            return copy;
          });
        },
        onUsage: (u) => setLastUsage(u),
        onError: (msg) => setErr(msg),
        onDone: () => setBusy(false),
      }
    );
    setBusy(false);
  }

  const color = branding?.primary_color || "#138DDE";
  const suggestions =
    customer?.instances.find((i) => i.id === instanceId)?.suggested_questions || [];

  return (
    <div className={styles.app}>
      <div className={styles.demoBanner}>
        ⚠️ DEMO MODE — sign-in is simulated with demo tokens. In production customers sign in via Microsoft Entra External ID.
      </div>
      <header className={styles.header} style={{ background: brandGradient(color) }}>
        <img src={branding?.logo_url || "/logo.svg"} className={styles.logo} alt="logo" />
        <div>
          <Text weight="bold" size={500}>
            {branding?.product_name || "AgentLoom"}
          </Text>
          {branding?.tagline && (
            <div>
              <Text size={200}>{branding.tagline}</Text>
            </div>
          )}
        </div>
        <div className={styles.spacer} />
        <div className={styles.row}>
          <Text size={200}>Demo customer:</Text>
          <Dropdown
            size="small"
            value={customer?.name || ""}
            selectedOptions={customer ? [customer.org_id] : []}
            onOptionSelect={(_, d) => {
              const c = customers.find((x) => x.org_id === d.optionValue);
              if (c) selectCustomer(c);
            }}
          >
            {customers.map((c) => (
              <Option key={c.org_id} value={c.org_id}>
                {c.name}
              </Option>
            ))}
          </Dropdown>
          {customer && customer.instances.length > 1 && (
            <Dropdown
              size="small"
              value={customer.instances.find((i) => i.id === instanceId)?.display_name || ""}
              selectedOptions={[instanceId]}
              onOptionSelect={(_, d) => setInstanceId(d.optionValue || "")}
            >
              {customer.instances.map((i) => (
                <Option key={i.id} value={i.id}>
                  {i.display_name}
                </Option>
              ))}
            </Dropdown>
          )}
          {getToken() ? (
            <Badge color="success">org: {branding?.org_id || customer?.org_id}</Badge>
          ) : (
            <Badge color="warning">no token</Badge>
          )}
        </div>
      </header>

      {err && <MessageBar intent="error">{err}</MessageBar>}

      <div className={styles.chat} ref={chatRef}>
        {messages.length === 0 && (
          <div className={styles.starter}>
            <Text align="center" size={300} style={{ color: tokens.colorNeutralForeground3 }}>
              Ask {branding?.org_name || customer?.name}'s assistant a question.
            </Text>
            {suggestions.length > 0 && (
              <div className={styles.chips}>
                {suggestions.map((q, i) => (
                  <div
                    key={i}
                    className={styles.chip}
                    style={{ borderColor: color, color }}
                    onClick={() => !busy && send(q)}
                  >
                    {q}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className={styles.bubbleUser} style={{ backgroundColor: color }}>
              {m.text}
            </div>
          ) : (
            <div key={i} className={styles.row} style={{ alignSelf: "flex-start" }}>
              <Avatar size={28} color="colorful" name={branding?.product_name || "A"} />
              <div className={styles.bubbleBot}>{m.text || (busy ? <Spinner size="tiny" /> : "")}</div>
            </div>
          )
        )}
      </div>

      {lastUsage && (
        <Text size={100} align="center" style={{ paddingBottom: 4, color: tokens.colorNeutralForeground3 }}>
          last turn: {lastUsage.total ?? 0} tokens (in {lastUsage.input ?? 0} / out {lastUsage.output ?? 0})
        </Text>
      )}

      <div className={styles.composer}>
        <Textarea
          style={{ flexGrow: 1 }}
          resize="vertical"
          value={input}
          placeholder="Type your message…"
          onChange={(_, d) => setInput(d.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          appearance="primary"
          icon={<Send24Filled />}
          disabled={busy || !input.trim()}
          onClick={() => send()}
          style={{ backgroundColor: color }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
