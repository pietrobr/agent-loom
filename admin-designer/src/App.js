import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Tab, TabList, Text, Button, Input, makeStyles, tokens, Badge, } from "@fluentui/react-components";
import { useBranding } from "./branding";
import { getToken, setToken, clearToken, devAdminLogin } from "./api";
import { TemplatesPage } from "./pages/TemplatesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { InstancesPage } from "./pages/InstancesPage";
import { MeteringPage } from "./pages/MeteringPage";
const useStyles = makeStyles({
    shell: { minHeight: "100vh", display: "flex", flexDirection: "column" },
    demoBanner: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "6px 12px",
        backgroundColor: "#7A4D00",
        color: "#FFE8B3",
        fontSize: "12px",
        fontWeight: 600,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 24px",
        color: "#fff",
    },
    logo: { height: "32px", width: "32px" },
    spacer: { flexGrow: 1 },
    body: { padding: "24px", flexGrow: 1, backgroundColor: tokens.colorNeutralBackground2 },
    tokenRow: { display: "flex", gap: "8px", alignItems: "center" },
});
export function App() {
    const styles = useStyles();
    const branding = useBranding();
    const loc = useLocation();
    const navigate = useNavigate();
    const [tok, setTok] = useState(getToken());
    const tabValue = loc.pathname.startsWith("/customers")
        ? "/customers"
        : loc.pathname.startsWith("/instances")
            ? "/instances"
            : loc.pathname.startsWith("/metering")
                ? "/metering"
                : "/";
    return (_jsxs("div", { className: styles.shell, children: [_jsx("div", { className: styles.demoBanner, children: "\u26A0\uFE0F DEMO MODE \u2014 admin sign-in is simulated (dev tokens). In production this uses Microsoft Entra ID." }), _jsxs("header", { className: styles.header, style: { backgroundColor: branding.PRIMARY_COLOR }, children: [_jsx("img", { src: branding.LOGO_URL, className: styles.logo, alt: "logo", style: { color: "#fff" } }), _jsxs(Text, { weight: "bold", size: 500, children: [branding.PRODUCT_NAME, " \u00B7 Designer"] }), _jsx("div", { className: styles.spacer }), _jsxs("div", { className: styles.tokenRow, children: [_jsx(Button, { size: "small", appearance: "primary", onClick: async () => {
                                    try {
                                        await devAdminLogin();
                                        location.reload();
                                    }
                                    catch (e) {
                                        alert(e.message);
                                    }
                                }, children: "Demo admin login" }), _jsx(Input, { size: "small", type: "password", placeholder: "Admin JWT", value: tok, onChange: (_, d) => setTok(d.value), style: { width: 200 } }), _jsx(Button, { size: "small", appearance: "secondary", onClick: () => {
                                    setToken(tok);
                                    location.reload();
                                }, children: "Save token" }), getToken() ? (_jsx(Badge, { color: "success", appearance: "filled", children: "authed" })) : (_jsx(Badge, { color: "warning", appearance: "filled", children: "no token" })), getToken() && (_jsx(Button, { size: "small", appearance: "transparent", style: { color: "#fff" }, onClick: () => {
                                    clearToken();
                                    location.reload();
                                }, children: "clear" }))] })] }), _jsxs(TabList, { selectedValue: tabValue, style: { paddingInline: 16 }, onTabSelect: (_, d) => navigate(String(d.value)), children: [_jsx(Tab, { value: "/", children: "Templates" }), _jsx(Tab, { value: "/customers", children: "Customers" }), _jsx(Tab, { value: "/instances", children: "Instances" }), _jsx(Tab, { value: "/metering", children: "Metering" })] }), _jsx("main", { className: styles.body, children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(TemplatesPage, {}) }), _jsx(Route, { path: "/customers", element: _jsx(CustomersPage, {}) }), _jsx(Route, { path: "/instances", element: _jsx(InstancesPage, {}) }), _jsx(Route, { path: "/metering", element: _jsx(MeteringPage, {}) })] }) })] }));
}
