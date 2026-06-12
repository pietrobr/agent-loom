/**
 * Thin API client for the AgentLoom backend.
 *
 * Auth model for the Designer: the partner's admin signs in with an admin
 * token. For the MVP we store an admin JWT in localStorage (minted by
 * `scripts/mint_demo_token.py _system admin-user admin` or issued by the
 * dev-token endpoint). Wire real Entra admin SSO in production.
 */
export const API_BASE = (window.__API_BASE__ ||
    import.meta.env?.VITE_API_BASE ||
    "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "agentloom_admin_token";
export function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t) {
    localStorage.setItem(TOKEN_KEY, t.trim());
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}
/**
 * Demo convenience: obtain an admin JWT from the backend dev-token endpoint
 * (only works when the backend has ALLOW_DEV_TOKENS=true). In production this
 * is replaced by the partner admin Entra ID sign-in flow.
 */
export async function devAdminLogin() {
    const res = await fetch(`${API_BASE}/v1/auth/dev-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: "_system", sub: "admin-user", roles: ["admin"] }),
    });
    if (!res.ok)
        throw new Error(`dev-token failed (${res.status}). Is ALLOW_DEV_TOKENS=true?`);
    const j = await res.json();
    setToken(j.access_token);
    return j.access_token;
}
async function req(path, init = {}, _retried = false) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
            ...(init.headers || {}),
        },
    });
    // Demo convenience: a stale/expired dev token returns 401. Transparently
    // refresh it once and retry. In production (no dev tokens) the refresh call
    // fails and the original 401 surfaces, prompting a real sign-in.
    if (res.status === 401 && !_retried) {
        try {
            await devAdminLogin();
            return req(path, init, true);
        }
        catch {
            /* fall through to throw below */
        }
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    if (res.status === 204)
        return undefined;
    return (await res.json());
}
// ---- Endpoints -------------------------------------------------------------
export const api = {
    listTemplates: () => req("/v1/admin/templates"),
    saveTemplate: (t) => req("/v1/admin/templates", { method: "POST", body: JSON.stringify(t) }),
    deleteTemplate: (id) => req(`/v1/admin/templates/${id}`, { method: "DELETE" }),
    listCustomers: () => req("/v1/admin/customers"),
    saveCustomer: (c) => req("/v1/admin/customers", { method: "POST", body: JSON.stringify(c) }),
    listInstances: (orgId) => req(`/v1/admin/customers/${orgId}/instances`),
    saveInstance: (orgId, i) => req(`/v1/admin/customers/${orgId}/instances`, {
        method: "POST",
        body: JSON.stringify(i),
    }),
    deleteInstance: (orgId, instanceId) => req(`/v1/admin/customers/${orgId}/instances/${instanceId}`, { method: "DELETE" }),
    metering: (orgId) => req(`/v1/admin/customers/${orgId}/metering`),
    uploadKnowledge: async (orgId, instanceId, title, source, file) => {
        const fd = new FormData();
        fd.append("title", title);
        fd.append("source", source);
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/v1/admin/customers/${orgId}/instances/${instanceId}/knowledge`, {
            method: "POST",
            headers: { Authorization: `Bearer ${getToken()}` },
            body: fd,
        });
        if (!res.ok)
            throw new Error(`${res.status}: ${await res.text()}`);
        return res.json();
    },
};
