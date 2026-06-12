import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Text, Input, Textarea, Dropdown, Option, Label, Badge, Spinner, makeStyles, MessageBar, } from "@fluentui/react-components";
import { api } from "../api";
const useStyles = makeStyles({
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" },
    list: { display: "flex", flexDirection: "column", gap: "12px" },
    form: { display: "flex", flexDirection: "column", gap: "10px" },
    card: { padding: "12px" },
    row: { display: "flex", gap: "8px", alignItems: "center" },
});
const EMPTY = {
    name: "",
    description: "",
    category: "general",
    model: "gpt-4o-mini",
    instructions: "",
    parameters: [],
    status: "draft",
};
export function TemplatesPage() {
    const styles = useStyles();
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState(EMPTY);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    async function load() {
        setLoading(true);
        setErr("");
        try {
            setItems(await api.listTemplates());
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
            await api.saveTemplate(draft);
            setDraft(EMPTY);
            await load();
        }
        catch (e) {
            setErr(e.message);
        }
    }
    return (_jsxs("div", { className: styles.grid, children: [_jsxs("div", { className: styles.list, children: [_jsx(Text, { weight: "semibold", size: 500, children: "Catalog templates" }), loading && _jsx(Spinner, { label: "Loading\u2026" }), err && _jsx(MessageBar, { intent: "error", children: err }), items.map((t) => (_jsxs(Card, { className: styles.card, children: [_jsx(CardHeader, { header: _jsxs("div", { className: styles.row, children: [_jsx(Text, { weight: "semibold", children: t.name }), _jsx(Badge, { appearance: "tint", color: t.status === "published" ? "success" : "warning", children: t.status })] }), description: _jsx(Text, { size: 200, children: t.description }) }), _jsxs(Text, { size: 200, children: ["category: ", t.category, " \u00B7 model: ", t.model, " \u00B7 a Foundry agent is created per customer when an instance is configured"] }), _jsxs("div", { className: styles.row, children: [_jsx(Button, { size: "small", onClick: () => setDraft(t), children: "Edit" }), _jsx(Button, { size: "small", appearance: "subtle", onClick: async () => {
                                            await api.deleteTemplate(t.id);
                                            load();
                                        }, children: "Delete" })] })] }, t.id)))] }), _jsxs(Card, { className: styles.card, children: [_jsx(Text, { weight: "semibold", size: 500, children: draft.id ? "Edit template" : "New template" }), _jsxs("div", { className: styles.form, children: [_jsx(Label, { children: "Name" }), _jsx(Input, { value: draft.name || "", onChange: (_, d) => setDraft({ ...draft, name: d.value }) }), _jsx(Label, { children: "Description" }), _jsx(Input, { value: draft.description || "", onChange: (_, d) => setDraft({ ...draft, description: d.value }) }), _jsx(Label, { children: "Category" }), _jsx(Input, { value: draft.category || "", onChange: (_, d) => setDraft({ ...draft, category: d.value }) }), _jsx(Label, { children: "Model deployment" }), _jsx(Input, { value: draft.model || "", onChange: (_, d) => setDraft({ ...draft, model: d.value }) }), _jsx(Label, { children: "Instructions" }), _jsx(Textarea, { resize: "vertical", value: draft.instructions || "", onChange: (_, d) => setDraft({ ...draft, instructions: d.value }) }), _jsx(Label, { children: "Status" }), _jsxs(Dropdown, { value: draft.status, selectedOptions: [draft.status || "draft"], onOptionSelect: (_, d) => setDraft({ ...draft, status: d.optionValue }), children: [_jsx(Option, { value: "draft", children: "draft" }), _jsx(Option, { value: "published", children: "published" })] }), _jsxs("div", { className: styles.row, children: [_jsx(Button, { appearance: "primary", onClick: save, disabled: !draft.name, children: "Save" }), _jsx(Button, { appearance: "secondary", onClick: () => setDraft(EMPTY), children: "Reset" })] })] })] })] }));
}
