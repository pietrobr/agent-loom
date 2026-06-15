import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button, Textarea, Text, Dropdown, Option, Spinner, Badge, makeStyles, tokens, Avatar, MessageBar, } from "@fluentui/react-components";
import { Send24Filled, ArrowClockwise20Regular } from "@fluentui/react-icons";
import { brandGradient } from "./theme";
import { Markdown } from "./Markdown";
import { devLogin, fetchBranding, fetchDemoCustomers, fetchMyInstances, getToken, streamChat, ApiError, } from "./api";
import { authEnabled, signOut } from "./auth";
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
export function App() {
    const styles = useStyles();
    const [customers, setCustomers] = useState([]);
    const [customer, setCustomer] = useState(null);
    const [instanceId, setInstanceId] = useState("");
    const [branding, setBranding] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [convId, setConvId] = useState();
    const [lastUsage, setLastUsage] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const chatRef = useRef(null);
    // Keep the browser tab title in sync with the selected customer's brand.
    useEffect(() => {
        if (branding?.product_name) {
            document.title = `${branding.product_name} — Customer App`;
        }
    }, [branding?.product_name]);
    // Sign in (dev) + load branding whenever the customer changes.
    async function selectCustomer(c) {
        setErr("");
        setCustomer(c);
        setInstanceId(c.instances[0]?.id || "");
        setMessages([]);
        setConvId(undefined);
        setLastUsage(null);
        try {
            await devLogin(c.org_id);
            setBranding(await fetchBranding());
        }
        catch (e) {
            setErr(e.message);
        }
    }
    // Load the real customer list (whatever exists in the backend). Keeps the
    // current selection if it still exists; otherwise selects the first one.
    async function loadCustomers(opts = {}) {
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
            const stillThere = opts.keepSelection && customer
                ? list.find((c) => c.org_id === customer.org_id)
                : undefined;
            if (stillThere) {
                setCustomers(list);
            }
            else if (!opts.keepSelection || !customer) {
                await selectCustomer(list[0]);
            }
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setRefreshing(false);
        }
    }
    // Initial load on mount.
    useEffect(() => {
        (async () => {
            try {
                if (authEnabled()) {
                    await loadSignedInCustomer();
                }
                else {
                    await loadCustomers();
                }
            }
            finally {
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
            const synthetic = {
                org_id: b.org_id,
                name: b.org_name || b.product_name,
                instances,
            };
            setCustomer(synthetic);
            setInstanceId(instances[0]?.id || "");
            if (!instances.length) {
                setErr("No chat instance is configured for your account yet.");
            }
        }
        catch (e) {
            // A disabled or removed customer is locked out server-side (403). Show a
            // friendly message and sign the user out.
            if (e instanceof ApiError && handleLockout(e.status, e.code))
                return;
            setErr(e.message);
        }
    }
    useEffect(() => {
        chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }, [messages]);
    // Friendly lock-out: a disabled/removed customer (403) gets a clear message
    // and is signed out, instead of a raw error. Returns true if handled.
    function handleLockout(status, code) {
        if (status !== 403 || (code !== "account_disabled" && code !== "account_removed")) {
            return false;
        }
        setMessages([]);
        setErr(code === "account_disabled"
            ? "Your access has been turned off by your administrator. You'll be signed out now."
            : "Your account is no longer available. You'll be signed out now.");
        setBusy(false);
        if (authEnabled())
            setTimeout(() => signOut(), 3000);
        return true;
    }
    async function send(textOverride) {
        const text = (textOverride ?? input).trim();
        if (!text || busy || !instanceId)
            return;
        setInput("");
        setErr("");
        setBusy(true);
        setMessages((m) => [...m, { role: "user", text }, { role: "bot", text: "" }]);
        let acc = "";
        await streamChat({ message: text, instance_id: instanceId, conversation_id: convId }, {
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
                if (handleLockout(status, code))
                    return;
                setErr(msg);
            },
            onDone: () => setBusy(false),
        });
        setBusy(false);
    }
    const color = branding?.primary_color || "#138DDE";
    const suggestions = customer?.instances.find((i) => i.id === instanceId)?.suggested_questions || [];
    const prod = authEnabled();
    // While the first sign-in + branding/instances load is in flight, show a
    // full-screen loader so the app doesn't look "ready" with an empty customer.
    if (initializing && !customer) {
        return (_jsx("div", { style: {
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
            }, children: _jsx(Spinner, { size: "huge", label: "Loading your workspace\u2026" }) }));
    }
    return (_jsxs("div", { className: styles.app, children: [!prod && (_jsx("div", { className: styles.demoBanner, children: "\u26A0\uFE0F DEMO MODE \u2014 sign-in is simulated with demo tokens. In production customers sign in via Microsoft Entra External ID." })), _jsxs("header", { className: styles.header, style: { background: brandGradient(color) }, children: [_jsx("img", { src: branding?.logo_url || "/logo.svg", className: styles.logo, alt: "logo" }), _jsxs("div", { children: [_jsx(Text, { weight: "bold", size: 500, children: branding?.product_name || "AgentLoom" }), branding?.tagline && (_jsx("div", { children: _jsx(Text, { size: 200, children: branding.tagline }) }))] }), _jsx("div", { className: styles.spacer }), _jsxs("div", { className: styles.row, children: [!prod && (_jsxs(_Fragment, { children: [_jsx(Text, { size: 200, children: "Demo customer:" }), _jsx(Dropdown, { size: "small", value: customer?.name || "", selectedOptions: customer ? [customer.org_id] : [], onOptionSelect: (_, d) => {
                                            const c = customers.find((x) => x.org_id === d.optionValue);
                                            if (c)
                                                selectCustomer(c);
                                        }, children: customers.map((c) => (_jsx(Option, { value: c.org_id, children: c.name }, c.org_id))) }), _jsx(Button, { appearance: "transparent", className: styles.refreshBtn, title: "Refresh customer list", "aria-label": "Refresh customer list", disabled: refreshing, icon: _jsx(ArrowClockwise20Regular, { className: refreshing ? styles.spin : undefined }), onClick: () => loadCustomers({ keepSelection: true }) })] })), customer && customer.instances.length > 1 && (_jsx(Dropdown, { size: "small", value: customer.instances.find((i) => i.id === instanceId)?.display_name || "", selectedOptions: [instanceId], onOptionSelect: (_, d) => setInstanceId(d.optionValue || ""), children: customer.instances.map((i) => (_jsx(Option, { value: i.id, children: i.display_name }, i.id))) })), getToken() ? (_jsxs(Badge, { color: "success", children: ["org: ", branding?.org_id || customer?.org_id] })) : (_jsx(Badge, { color: "warning", children: "no token" }))] })] }), err && _jsx(MessageBar, { intent: "error", children: err }), _jsxs("div", { className: styles.chat, ref: chatRef, children: [messages.length === 0 && (_jsxs("div", { className: styles.starter, children: [_jsxs(Text, { align: "center", size: 300, style: { color: tokens.colorNeutralForeground3 }, children: ["Ask ", branding?.org_name || customer?.name, "'s assistant a question."] }), suggestions.length > 0 && (_jsx("div", { className: styles.chips, children: suggestions.map((q, i) => (_jsx("div", { className: styles.chip, style: { borderColor: color, color }, onClick: () => !busy && send(q), children: q }, i))) }))] })), messages.map((m, i) => m.role === "user" ? (_jsx("div", { className: styles.bubbleUser, style: { backgroundColor: color }, children: m.text }, i)) : (_jsxs("div", { className: styles.row, style: { alignSelf: "flex-start" }, children: [_jsx(Avatar, { size: 28, color: "colorful", name: branding?.product_name || "A" }), _jsx("div", { className: styles.bubbleBot, children: m.text ? _jsx(Markdown, { text: m.text }) : busy ? _jsx(Spinner, { size: "tiny" }) : "" })] }, i)))] }), lastUsage && (_jsxs(Text, { size: 100, align: "center", style: { paddingBottom: 4, color: tokens.colorNeutralForeground3 }, children: ["last turn: ", lastUsage.total ?? 0, " tokens (in ", lastUsage.input ?? 0, " / out ", lastUsage.output ?? 0, ")"] })), _jsxs("div", { className: styles.composer, children: [_jsx(Textarea, { style: { flexGrow: 1 }, resize: "vertical", value: input, placeholder: "Type your message\u2026", onChange: (_, d) => setInput(d.value), onKeyDown: (e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                send();
                            }
                        } }), _jsx(Button, { appearance: "primary", icon: _jsx(Send24Filled, {}), disabled: busy || !input.trim(), onClick: () => send(), style: { backgroundColor: color }, children: "Send" })] })] }));
}
