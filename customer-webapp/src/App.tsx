import { useEffect, useRef, useState } from "react";
import {
  Button,
  Text,
  Dropdown,  Option,
  Spinner,
  Badge,
  makeStyles,
  tokens,
  MessageBar,
} from "@fluentui/react-components";
import { Send24Filled, ArrowClockwise20Regular, SignOut20Regular, Attach24Regular } from "@fluentui/react-icons";
import { brandGradient } from "./theme";
import { Markdown } from "./Markdown";
import {
  BrandingResponse,
  DemoCustomer,
  devLogin,
  fetchBranding,
  fetchDemoCustomers,
  fetchMyInstances,
  getToken,
  setToken,
  streamChat,
  extractFile,
  ApiError,
} from "./api";
import { authEnabled, signOut, signIn } from "./auth";

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
  refreshBtn: {
    minWidth: "32px",
    width: "32px",
    height: "32px",
    padding: 0,
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: "8px",
    transition: "background-color 120ms ease, transform 120ms ease",
    ":hover": {
      backgroundColor: "rgba(255,255,255,0.28)",
      color: "#fff",
      transform: "translateY(-1px)",
    },
    ":active": { transform: "translateY(0)" },
  },
  spin: {
    animationName: {
      from: { transform: "rotate(0deg)" },
      to: { transform: "rotate(360deg)" },
    },
    animationDuration: "0.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
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
    overflowWrap: "anywhere",
  },
  composer: {
    display: "flex",
    justifyContent: "center",
    padding: "12px 20px 18px",
  },
  composerBar: {
    width: "100%",
    maxWidth: "820px",
    display: "flex",
    alignItems: "flex-end",
    gap: "6px",
    padding: "7px 8px 7px 10px",
    borderRadius: "26px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    transition: "border-color 120ms ease, box-shadow 120ms ease",
  },
  ta: {
    flexGrow: 1,
    alignSelf: "center",
    border: "none",
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: "15px",
    lineHeight: "22px",
    padding: "8px 4px",
    maxHeight: "200px",
    overflowY: "auto",
    "::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  iconBtn: {
    minWidth: "36px",
    width: "36px",
    height: "36px",
    padding: 0,
    borderRadius: "999px",
    flexShrink: 0,
  },
  sendBtn: {
    minWidth: "36px",
    width: "36px",
    height: "36px",
    padding: 0,
    borderRadius: "999px",
    flexShrink: 0,
  },
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
  const [refreshing, setRefreshing] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [uploading, setUploading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer textarea up to a max height, then scroll.
  function autoResize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }
  useEffect(autoResize, [input]);

  // Keep the browser tab title in sync with the selected customer's brand.
  useEffect(() => {
    if (branding?.product_name) {
      document.title = `${branding.product_name} — Customer App`;
    }
  }, [branding?.product_name]);

  // Swap the browser tab favicon to the selected customer's logo.
  useEffect(() => {
    const href = branding?.logo_url || "/logo.svg";
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = href;
  }, [branding?.logo_url]);

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

  // Load the real customer list (whatever exists in the backend). Keeps the
  // current selection if it still exists; otherwise selects the first one.
  async function loadCustomers(opts: { keepSelection?: boolean } = {}) {
    setRefreshing(true);
    setErr("");
    try {
      const list = await fetchDemoCustomers();
      setCustomers(list);
      if (!list.length) {
        setCustomer(null);
        setErr("No customers with an assigned instance yet. Create one in the Designer.");
        return;
      }
      const stillThere =
        opts.keepSelection && customer
          ? list.find((c) => c.org_id === customer.org_id)
          : undefined;
      if (stillThere) {
        setCustomers(list);
      } else if (!opts.keepSelection || !customer) {
        await selectCustomer(list[0]);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Initial load on mount.
  useEffect(() => {
    (async () => {
      try {
        if (authEnabled()) {
          await loadSignedInCustomer();
        } else {
          await loadCustomers();
        }
      } finally {
        setInitializing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Production: the user is already signed in (Entra External ID) and main.tsx
  // cached an API token. The org_id comes from the token, so there is no
  // switcher — just load this customer's branding + instances.
  async function loadSignedInCustomer() {
    setErr("");
    try {
      const [b, instances] = await Promise.all([fetchBranding(), fetchMyInstances()]);
      setBranding(b);
      const synthetic: DemoCustomer = {
        org_id: b.org_id,
        name: b.org_name || b.product_name,
        instances,
      };
      setCustomer(synthetic);
      setInstanceId(instances[0]?.id || "");
      if (!instances.length) {
        setErr("No chat instance is configured for your account yet.");
      }
    } catch (e: any) {
      // A disabled or removed customer is locked out server-side (403). Show a
      // friendly message and sign the user out.
      if (e instanceof ApiError && handleLockout(e.status, e.code)) return;
      setErr(e.message);
    }
  }

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Friendly lock-out: a disabled/removed customer (403), or a user not linked
  // to any organization yet (403 account_unassigned), gets a clear message and
  // is signed out, instead of a raw error. Returns true if handled.
  function handleLockout(status?: number, code?: string): boolean {
    if (
      status !== 403 ||
      (code !== "account_disabled" &&
        code !== "account_removed" &&
        code !== "account_unassigned")
    ) {
      return false;
    }
    setMessages([]);
    setErr(
      code === "account_disabled"
        ? "Your access has been turned off by your administrator. You'll be signed out now."
        : code === "account_unassigned"
        ? "Your account isn't linked to any organization yet. Please contact your administrator, then sign in again."
        : "Your account is no longer available. You'll be signed out now."
    );
    setBusy(false);
    if (authEnabled()) setTimeout(() => doSignOut(), 3000);
    return true;
  }

  // Sign out locally and show the "signed out" screen (no bounce to login).
  async function doSignOut() {
    try {
      await signOut();
    } finally {
      setSignedOut(true);
    }
  }

  // Read an attached document (e.g. a CV), extract its text server-side, and
  // drop it into the composer prefixed with a short instruction so the user can
  // review and hit Send.
  async function onAttach(file: File) {
    setErr("");
    setUploading(true);
    try {
      const res = await extractFile(file);
      const header = `Please evaluate the attached document "${res.filename}".`;
      const note = res.truncated ? "\n\n(Note: the document was long and has been truncated.)" : "";
      const block = `${header}\n\n--- BEGIN DOCUMENT ---\n${res.text}\n--- END DOCUMENT ---${note}`;
      setInput((cur) => (cur.trim() ? `${cur.trim()}\n\n${block}` : block));
    } catch (e: any) {
      setErr(e.message || "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

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
        onError: (msg, status, code) => {
          if (handleLockout(status, code)) return;
          setErr(msg);
        },
        onDone: () => setBusy(false),
      }
    );
    setBusy(false);
  }

  const color = branding?.primary_color || "#138DDE";
  const suggestions =
    customer?.instances.find((i) => i.id === instanceId)?.suggested_questions || [];
  const prod = authEnabled();

  // After signing out, show a calm goodbye screen instead of bouncing the user
  // straight back to the login mask.
  if (signedOut) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          textAlign: "center",
          padding: 24,
        }}
      >
        <img src={branding?.logo_url || "/logo.svg"} alt="logo" style={{ height: 48, marginBottom: 4 }} />
        <Text size={600} weight="semibold">You've been signed out</Text>
        <Text size={300} style={{ color: tokens.colorNeutralForeground3, maxWidth: 420 }}>
          It's now safe to close this tab.
        </Text>
        <Button
          appearance="primary"
          style={{ marginTop: 8, backgroundColor: color }}
          onClick={() => signIn()}
        >
          Sign in again
        </Button>
      </div>
    );
  }

  // While the first sign-in + branding/instances load is in flight, show a
  // full-screen loader so the app doesn't look "ready" with an empty customer.
  if (initializing && !customer) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <Spinner size="huge" label="Loading your workspace…" />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      {!prod && (
        <div className={styles.demoBanner}>
          ⚠️ DEMO MODE — sign-in is simulated with demo tokens. In production customers sign in via Microsoft Entra External ID.
        </div>
      )}
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
          {!prod && (
            <>
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
              <Button
                appearance="transparent"
                className={styles.refreshBtn}
                title="Refresh customer list"
                aria-label="Refresh customer list"
                disabled={refreshing}
                icon={
                  <ArrowClockwise20Regular className={refreshing ? styles.spin : undefined} />
                }
                onClick={() => loadCustomers({ keepSelection: true })}
              />
            </>
          )}
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
          {prod && (
            <Button
              appearance="transparent"
              style={{ color: "#fff" }}
              icon={<SignOut20Regular />}
              title="Sign out"
              onClick={() => doSignOut()}
            >
              Sign out
            </Button>
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
              <img
                src={branding?.logo_url || "/logo.svg"}
                alt="assistant"
                width={28}
                height={28}
                style={{ borderRadius: "50%", flexShrink: 0 }}
              />
              <div className={styles.bubbleBot}>
                {m.text ? <Markdown text={m.text} /> : busy ? <Spinner size="tiny" /> : ""}
              </div>
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
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAttach(f);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <div className={styles.composerBar}>
          <Button
            appearance="subtle"
            className={styles.iconBtn}
            icon={uploading ? <Spinner size="tiny" /> : <Attach24Regular />}
            disabled={busy || uploading || !instanceId}
            title="Attach a document (PDF, DOCX, TXT, MD) — e.g. a CV to evaluate"
            aria-label="Attach a document"
            onClick={() => fileRef.current?.click()}
          />
          <textarea
            ref={taRef}
            className={styles.ta}
            rows={1}
            value={input}
            placeholder="Type your message…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button
            appearance="primary"
            className={styles.sendBtn}
            icon={<Send24Filled />}
            disabled={busy || !input.trim()}
            onClick={() => send()}
            title="Send"
            aria-label="Send"
            style={{ backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}
