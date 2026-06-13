import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button, Textarea, Text, Dropdown, Option, Spinner, Badge, makeStyles, tokens, Avatar, MessageBar, } from "@fluentui/react-components";
import { Send24Filled } from "@fluentui/react-icons";
import { brandGradient } from "./theme";
import { devLogin, fetchBranding, fetchDemoCustomers, getToken, streamChat, } from "./api";
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
    const chatRef = useRef(null);
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
    // Load the real customer list (whatever exists in the backend) on mount.
    useEffect(() => {
        fetchDemoCustomers()
            .then((list) => {
            setCustomers(list);
            if (list.length)
                selectCustomer(list[0]);
            else
                setErr("No customers with an assigned instance yet. Create one in the Designer.");
        })
            .catch((e) => setErr(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }, [messages]);
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
            onError: (msg) => setErr(msg),
            onDone: () => setBusy(false),
        });
        setBusy(false);
    }
    const color = branding?.primary_color || "#138DDE";
    const suggestions = customer?.instances.find((i) => i.id === instanceId)?.suggested_questions || [];
    return (_jsxs("div", { className: styles.app, children: [_jsx("div", { className: styles.demoBanner, children: "\u26A0\uFE0F DEMO MODE \u2014 sign-in is simulated with demo tokens. In production customers sign in via Microsoft Entra External ID." }), _jsxs("header", { className: styles.header, style: { background: brandGradient(color) }, children: [_jsx("img", { src: branding?.logo_url || "/logo.svg", className: styles.logo, alt: "logo" }), _jsxs("div", { children: [_jsx(Text, { weight: "bold", size: 500, children: branding?.product_name || "AgentLoom" }), branding?.tagline && (_jsx("div", { children: _jsx(Text, { size: 200, children: branding.tagline }) }))] }), _jsx("div", { className: styles.spacer }), _jsxs("div", { className: styles.row, children: [_jsx(Text, { size: 200, children: "Demo customer:" }), _jsx(Dropdown, { size: "small", value: customer?.name || "", selectedOptions: customer ? [customer.org_id] : [], onOptionSelect: (_, d) => {
                                    const c = customers.find((x) => x.org_id === d.optionValue);
                                    if (c)
                                        selectCustomer(c);
                                }, children: customers.map((c) => (_jsx(Option, { value: c.org_id, children: c.name }, c.org_id))) }), customer && customer.instances.length > 1 && (_jsx(Dropdown, { size: "small", value: customer.instances.find((i) => i.id === instanceId)?.display_name || "", selectedOptions: [instanceId], onOptionSelect: (_, d) => setInstanceId(d.optionValue || ""), children: customer.instances.map((i) => (_jsx(Option, { value: i.id, children: i.display_name }, i.id))) })), getToken() ? (_jsxs(Badge, { color: "success", children: ["org: ", branding?.org_id || customer?.org_id] })) : (_jsx(Badge, { color: "warning", children: "no token" }))] })] }), err && _jsx(MessageBar, { intent: "error", children: err }), _jsxs("div", { className: styles.chat, ref: chatRef, children: [messages.length === 0 && (_jsxs("div", { className: styles.starter, children: [_jsxs(Text, { align: "center", size: 300, style: { color: tokens.colorNeutralForeground3 }, children: ["Ask ", branding?.org_name || customer?.name, "'s assistant a question."] }), suggestions.length > 0 && (_jsx("div", { className: styles.chips, children: suggestions.map((q, i) => (_jsx("div", { className: styles.chip, style: { borderColor: color, color }, onClick: () => !busy && send(q), children: q }, i))) }))] })), messages.map((m, i) => m.role === "user" ? (_jsx("div", { className: styles.bubbleUser, style: { backgroundColor: color }, children: m.text }, i)) : (_jsxs("div", { className: styles.row, style: { alignSelf: "flex-start" }, children: [_jsx(Avatar, { size: 28, color: "colorful", name: branding?.product_name || "A" }), _jsx("div", { className: styles.bubbleBot, children: m.text || (busy ? _jsx(Spinner, { size: "tiny" }) : "") })] }, i)))] }), lastUsage && (_jsxs(Text, { size: 100, align: "center", style: { paddingBottom: 4, color: tokens.colorNeutralForeground3 }, children: ["last turn: ", lastUsage.total ?? 0, " tokens (in ", lastUsage.input ?? 0, " / out ", lastUsage.output ?? 0, ")"] })), _jsxs("div", { className: styles.composer, children: [_jsx(Textarea, { style: { flexGrow: 1 }, resize: "vertical", value: input, placeholder: "Type your message\u2026", onChange: (_, d) => setInput(d.value), onKeyDown: (e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                send();
                            }
                        } }), _jsx(Button, { appearance: "primary", icon: _jsx(Send24Filled, {}), disabled: busy || !input.trim(), onClick: () => send(), style: { backgroundColor: color }, children: "Send" })] })] }));
}
