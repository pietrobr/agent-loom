import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Card, Text, Dropdown, Option, Field, Spinner, MessageBar, Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell, makeStyles, } from "@fluentui/react-components";
import { api } from "../api";
const useStyles = makeStyles({
    wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" },
    stats: { display: "flex", gap: "16px" },
    stat: { padding: "16px", flexGrow: 1, textAlign: "center" },
});
export function MeteringPage() {
    const styles = useStyles();
    const [customers, setCustomers] = useState([]);
    const [orgId, setOrgId] = useState("");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    useEffect(() => {
        api
            .listCustomers()
            .then((c) => {
            setCustomers(c);
            if (c.length)
                setOrgId(c[0].org_id);
        })
            .catch((e) => setErr(e.message));
    }, []);
    useEffect(() => {
        if (!orgId)
            return;
        setLoading(true);
        setErr("");
        api
            .metering(orgId)
            .then(setData)
            .catch((e) => setErr(e.message))
            .finally(() => setLoading(false));
    }, [orgId]);
    return (_jsxs("div", { className: styles.wrap, children: [_jsx(Field, { label: "Customer", children: _jsx(Dropdown, { value: customers.find((c) => c.org_id === orgId)?.name || "", selectedOptions: [orgId], onOptionSelect: (_, d) => setOrgId(d.optionValue || ""), children: customers.map((c) => (_jsx(Option, { value: c.org_id, children: c.name }, c.org_id))) }) }), loading && _jsx(Spinner, { label: "Loading\u2026" }), err && _jsx(MessageBar, { intent: "error", children: err }), data && (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.stats, children: [_jsxs(Card, { className: styles.stat, children: [_jsx(Text, { size: 700, weight: "bold", children: data.calls }), _jsx("div", { children: _jsx(Text, { size: 200, children: "total calls" }) })] }), _jsxs(Card, { className: styles.stat, children: [_jsx(Text, { size: 700, weight: "bold", children: data.total_tokens.toLocaleString() }), _jsx("div", { children: _jsx(Text, { size: 200, children: "total tokens" }) })] })] }), _jsxs(Card, { children: [_jsx(Text, { weight: "semibold", children: "Usage by instance" }), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHeaderCell, { children: "Instance" }), _jsx(TableHeaderCell, { children: "Calls" }), _jsx(TableHeaderCell, { children: "Tokens" })] }) }), _jsxs(TableBody, { children: [Object.entries(data.by_instance).map(([k, v]) => (_jsxs(TableRow, { children: [_jsx(TableCell, { children: _jsx("code", { children: k }) }), _jsx(TableCell, { children: v.calls }), _jsx(TableCell, { children: v.tokens.toLocaleString() })] }, k))), Object.keys(data.by_instance).length === 0 && (_jsxs(TableRow, { children: [_jsx(TableCell, { children: "No usage yet" }), _jsx(TableCell, { children: "\u2014" }), _jsx(TableCell, { children: "\u2014" })] }))] })] })] })] }))] }));
}
