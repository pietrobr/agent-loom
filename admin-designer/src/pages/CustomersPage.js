import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Text, Input, Label, Dropdown, Option, Badge, Spinner, MessageBar, makeStyles, } from "@fluentui/react-components";
import { api } from "../api";
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
    tier: "starter",
    monthly_token_quota: 1_000_000,
    branding: { product_name: "", primary_color: "#5B5FC7", logo_url: "/logo.svg", tagline: "" },
};
export function CustomersPage() {
    const styles = useStyles();
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState(EMPTY);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    async function load() {
        setLoading(true);
        setErr("");
        try {
            setItems(await api.listCustomers());
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
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
        }
        catch (e) {
            setErr(e.message);
        }
    }
    return (_jsxs("div", { className: styles.grid, children: [_jsxs("div", { className: styles.list, children: [_jsx(Text, { weight: "semibold", size: 500, children: "Customers" }), loading && _jsx(Spinner, { label: "Loading\u2026" }), err && _jsx(MessageBar, { intent: "error", children: err }), items.map((t) => (_jsxs(Card, { className: styles.card, children: [_jsx(CardHeader, { header: _jsxs("div", { className: styles.row, children: [_jsx(Text, { weight: "semibold", children: t.name }), _jsx(Badge, { appearance: "tint", children: t.tier })] }), description: _jsxs(Text, { size: 200, children: ["org_id: ", _jsx("code", { children: t.org_id }), " \u00B7 index: ", _jsx("code", { children: t.search_index })] }) }), _jsxs(Text, { size: 200, children: ["quota: ", t.monthly_token_quota.toLocaleString(), " tokens / month"] }), _jsx("div", { className: styles.row, children: _jsx(Button, { size: "small", onClick: () => setDraft(t), children: "Edit" }) })] }, t.org_id)))] }), _jsxs(Card, { className: styles.card, children: [_jsx(Text, { weight: "semibold", size: 500, children: items.find((i) => i.org_id === draft.org_id) ? "Edit customer" : "Onboard customer" }), _jsx(Text, { size: 200, children: "Saving auto-creates the per-customer Search index kb-{org_id}." }), _jsxs("div", { className: styles.form, children: [_jsx(Label, { children: "org_id (slug, immutable)" }), _jsx(Input, { value: draft.org_id, onChange: (_, d) => setDraft({ ...draft, org_id: d.value }) }), _jsx(Label, { children: "Display name" }), _jsx(Input, { value: draft.name, onChange: (_, d) => setDraft({ ...draft, name: d.value }) }), _jsx(Label, { children: "Tier" }), _jsxs(Dropdown, { selectedOptions: [draft.tier], value: draft.tier, onOptionSelect: (_, d) => setDraft({ ...draft, tier: d.optionValue }), children: [_jsx(Option, { value: "free", children: "free" }), _jsx(Option, { value: "starter", children: "starter" }), _jsx(Option, { value: "pro", children: "pro" })] }), _jsx(Label, { children: "Monthly token quota" }), _jsx(Input, { type: "number", value: String(draft.monthly_token_quota), onChange: (_, d) => setDraft({ ...draft, monthly_token_quota: Number(d.value) }) }), _jsx(Label, { children: "Brand: product name" }), _jsx(Input, { value: draft.branding.product_name, onChange: (_, d) => setDraft({ ...draft, branding: { ...draft.branding, product_name: d.value } }) }), _jsx(Label, { children: "Brand: primary color" }), _jsx(Input, { value: draft.branding.primary_color, onChange: (_, d) => setDraft({ ...draft, branding: { ...draft.branding, primary_color: d.value } }) }), _jsx(Label, { children: "Brand: tagline" }), _jsx(Input, { value: draft.branding.tagline, onChange: (_, d) => setDraft({ ...draft, branding: { ...draft.branding, tagline: d.value } }) }), _jsxs("div", { className: styles.row, children: [_jsx(Button, { appearance: "primary", onClick: save, disabled: !draft.org_id || !draft.name, children: "Save" }), _jsx(Button, { appearance: "secondary", onClick: () => setDraft(EMPTY), children: "Reset" })] })] })] })] }));
}
