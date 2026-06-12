import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Text, Input, Textarea, Label, Dropdown, Option, Spinner, MessageBar, Field, Dialog, DialogTrigger, DialogSurface, DialogTitle, DialogBody, DialogActions, DialogContent, makeStyles, } from "@fluentui/react-components";
import { Delete24Regular } from "@fluentui/react-icons";
import { api } from "../api";
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
    const [customers, setCustomers] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [orgId, setOrgId] = useState("");
    const [instances, setInstances] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);
    // New-instance draft
    const [templateId, setTemplateId] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [addendum, setAddendum] = useState("");
    // Knowledge upload
    const [kInstanceId, setKInstanceId] = useState("");
    const [kTitle, setKTitle] = useState("");
    const [kFile, setKFile] = useState(null);
    const [uploadMsg, setUploadMsg] = useState("");
    // Instance removal
    const [toDelete, setToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    useEffect(() => {
        (async () => {
            try {
                const [c, t] = await Promise.all([api.listCustomers(), api.listTemplates()]);
                setCustomers(c);
                setTemplates(t);
                if (c.length && !orgId)
                    setOrgId(c[0].org_id);
            }
            catch (e) {
                setErr(e.message);
            }
        })();
    }, []);
    async function loadInstances(id) {
        if (!id)
            return;
        setLoading(true);
        setErr("");
        try {
            const list = await api.listInstances(id);
            setInstances(list);
            // keep the upload target valid
            setKInstanceId((prev) => list.some((i) => i.id === prev) ? prev : list[0]?.id || "");
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
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
        }
        catch (e) {
            setErr(e.message);
        }
    }
    async function upload() {
        if (!kFile || !kTitle || !kInstanceId)
            return;
        setUploadMsg("");
        try {
            const r = await api.uploadKnowledge(orgId, kInstanceId, kTitle, "upload", kFile);
            setUploadMsg(`Indexed doc ${r.id}`);
            setKTitle("");
            setKFile(null);
        }
        catch (e) {
            setUploadMsg("Error: " + e.message);
        }
    }
    async function confirmDelete() {
        if (!toDelete)
            return;
        setDeleting(true);
        setErr("");
        try {
            await api.deleteInstance(orgId, toDelete.id);
            setToDelete(null);
            await loadInstances(orgId);
        }
        catch (e) {
            setErr(e.message);
        }
        finally {
            setDeleting(false);
        }
    }
    return (_jsxs("div", { className: styles.grid, children: [_jsxs("div", { className: styles.list, children: [_jsx(Field, { label: "Customer", children: _jsx(Dropdown, { value: customers.find((c) => c.org_id === orgId)?.name || "", selectedOptions: [orgId], onOptionSelect: (_, d) => setOrgId(d.optionValue || ""), children: customers.map((c) => (_jsx(Option, { value: c.org_id, children: c.name }, c.org_id))) }) }), _jsxs(Text, { weight: "semibold", size: 500, children: ["Instances for ", orgId || "—"] }), loading && _jsx(Spinner, { label: "Loading\u2026" }), err && _jsx(MessageBar, { intent: "error", children: err }), instances.map((i) => (_jsxs(Card, { className: styles.card, children: [_jsxs("div", { className: styles.cardTop, children: [_jsx(CardHeader, { header: _jsx(Text, { weight: "semibold", children: i.display_name }), description: _jsxs(Text, { size: 200, children: ["template: ", _jsx("code", { children: i.template_id }), " \u00B7 agent:", " ", i.foundry_agent_id ? _jsx("code", { children: i.foundry_agent_id }) : _jsx("em", { children: "pending" })] }) }), _jsx(Button, { size: "small", appearance: "subtle", icon: _jsx(Delete24Regular, {}), "aria-label": "Remove instance", onClick: () => setToDelete(i), children: "Remove" })] }), i.overrides?.instructions_addendum && (_jsx(Text, { size: 200, italic: true, children: String(i.overrides.instructions_addendum) }))] }, i.id)))] }), _jsxs("div", { className: styles.list, children: [_jsxs(Card, { className: styles.card, children: [_jsx(Text, { weight: "semibold", size: 500, children: "Assign template" }), _jsx(Text, { size: 200, children: "Creates a dedicated Foundry agent for this customer from the chosen template blueprint." }), _jsxs("div", { className: styles.form, children: [_jsx(Label, { children: "Template" }), _jsx(Dropdown, { value: templates.find((t) => t.id === templateId)?.name || "", selectedOptions: [templateId], onOptionSelect: (_, d) => setTemplateId(d.optionValue || ""), children: templates.map((t) => (_jsx(Option, { value: t.id, children: t.name }, t.id))) }), _jsx(Label, { children: "Display name" }), _jsx(Input, { value: displayName, onChange: (_, d) => setDisplayName(d.value) }), _jsx(Label, { children: "Instructions addendum (customer override)" }), _jsx(Textarea, { resize: "vertical", value: addendum, onChange: (_, d) => setAddendum(d.value) }), _jsx(Button, { appearance: "primary", onClick: assign, disabled: !orgId || !templateId || !displayName, children: "Assign" })] })] }), _jsxs(Card, { className: styles.card, children: [_jsx(Text, { weight: "semibold", size: 500, children: "Upload knowledge (private)" }), _jsxs(Text, { size: 200, children: ["Stored in a per-instance Blob folder and indexed into kb-", orgId, "(scoped to the chosen instance). Removed when the instance is deleted."] }), _jsxs("div", { className: styles.form, children: [_jsx(Label, { children: "Instance" }), _jsx(Dropdown, { value: instances.find((i) => i.id === kInstanceId)?.display_name || "", selectedOptions: [kInstanceId], onOptionSelect: (_, d) => setKInstanceId(d.optionValue || ""), children: instances.map((i) => (_jsx(Option, { value: i.id, children: i.display_name }, i.id))) }), _jsx(Label, { children: "Title" }), _jsx(Input, { value: kTitle, onChange: (_, d) => setKTitle(d.value) }), _jsx(Label, { children: "File (.txt / .md)" }), _jsx("input", { type: "file", accept: ".txt,.md,.json", onChange: (e) => setKFile(e.target.files?.[0] || null) }), _jsx(Button, { appearance: "primary", onClick: upload, disabled: !orgId || !kInstanceId || !kFile || !kTitle, children: "Upload & index" }), uploadMsg && _jsx(MessageBar, { intent: "info", children: uploadMsg })] })] })] }), _jsx(Dialog, { open: !!toDelete, onOpenChange: (_, d) => !d.open && setToDelete(null), children: _jsx(DialogSurface, { children: _jsxs(DialogBody, { children: [_jsx(DialogTitle, { children: "Remove instance?" }), _jsxs(DialogContent, { children: [_jsxs(Text, { children: ["You are about to permanently remove", " ", _jsx("strong", { children: toDelete?.display_name }), " from ", _jsx("code", { children: orgId }), "."] }), _jsxs("ul", { children: [_jsx("li", { children: "its dedicated Foundry agent will be deleted" }), _jsx("li", { children: "its knowledge base (indexed docs + blob folder) will be deleted" })] }), _jsx(Text, { children: "This action cannot be undone." })] }), _jsxs(DialogActions, { children: [_jsx(DialogTrigger, { disableButtonEnhancement: true, children: _jsx(Button, { appearance: "secondary", disabled: deleting, children: "Cancel" }) }), _jsx(Button, { appearance: "primary", onClick: confirmDelete, disabled: deleting, children: deleting ? _jsx(Spinner, { size: "tiny" }) : "Delete instance + KB" })] })] }) }) })] }));
}
