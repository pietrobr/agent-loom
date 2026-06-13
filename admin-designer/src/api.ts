/**
 * Thin API client for the AgentLoom backend.
 *
 * Auth model for the Designer: the partner's admin signs in with an admin
 * token. For the MVP we store an admin JWT in localStorage (minted by
 * `scripts/mint_demo_token.py _system admin-user admin` or issued by the
 * dev-token endpoint). Wire real Entra admin SSO in production.
 */

export const API_BASE: string =
  ((window as any).__API_BASE__ ||
    (import.meta as any).env?.VITE_API_BASE ||
    "http://localhost:8000").replace(/\/$/, "");

const TOKEN_KEY = "agentloom_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t.trim());
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Demo convenience: obtain an admin JWT from the backend dev-token endpoint
 * (only works when the backend has ALLOW_DEV_TOKENS=true). In production this
 * is replaced by the partner admin Entra ID sign-in flow.
 */
export async function devAdminLogin(): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ org_id: "_system", sub: "admin-user", roles: ["admin"] }),
  });
  if (!res.ok) throw new Error(`dev-token failed (${res.status}). Is ALLOW_DEV_TOKENS=true?`);
  const j = await res.json();
  setToken(j.access_token);
  return j.access_token;
}

async function req<T>(path: string, init: RequestInit = {}, _retried = false): Promise<T> {
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
      return req<T>(path, init, true);
    } catch {
      /* fall through to throw below */
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Types -----------------------------------------------------------------
export interface TemplateParam {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  default?: unknown;
  required?: boolean;
}
export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  foundry_agent_id?: string;
  model: string;
  allowed_models?: string[];
  instructions: string;
  parameters: TemplateParam[];
  status: "draft" | "published";
}
export interface Branding {
  product_name: string;
  primary_color: string;
  logo_url: string;
  tagline: string;
}
export interface Tenant {
  id: string;
  org_id: string;
  name: string;
  tier: "free" | "starter" | "pro";
  enabled?: boolean;
  monthly_token_quota: number;
  branding: Branding;
  search_index: string;
}
export interface Instance {
  id: string;
  org_id: string;
  template_id: string;
  display_name: string;
  overrides: Record<string, unknown>;
  branding?: Branding;
  model?: string;
  suggested_questions?: string[];
  foundry_agent_id?: string;
}
export interface MeteringDay {
  date: string;
  calls: number;
  tokens: number;
}
export interface Metering {
  calls: number;
  total_tokens: number;
  by_instance: Record<string, { calls: number; tokens: number }>;
  by_day?: MeteringDay[];
}

export interface CostClient {
  org_id: string;
  name: string;
  tokens: number;
  calls: number;
  indices: number;
  documents: number;
  infra_weight: number;
  active_days: number;
  days_in_month: number;
  active_fraction: number;
  token_cost: number;
  search_cost: number;
  infra_cost: number;
  total_cost: number;
}
export interface CostMonth {
  month: string;
  token_cost: number;
  search_cost: number;
  infra_cost: number;
  infra_full?: number;
  total_cost: number;
  active_clients: number;
  days_in_month?: number;
  weights?: { tokens: number; calls: number; documents: number };
  clients: CostClient[];
}
export interface CostSummary {
  currency: string;
  region?: string;
  updated?: string | null;
  source?: string;
  search_monthly: number;
  infra_monthly: number;
  infra_breakdown: Record<string, number>;
  weights?: { tokens: number; calls: number; documents: number };
  total_cost: number;
  by_month: CostMonth[];
}
export interface AgentTool {
  type?: string;
  name?: string;
  enabled: boolean;
  // tools carry a stable identity key derived server-side
  [k: string]: unknown;
}
export interface AgentInfo {
  name: string;
  version?: string | null;
  model?: string | null;
  portal_url?: string | null;
  tools: AgentTool[];
}

// ---- Endpoints -------------------------------------------------------------
export const api = {
  listTemplates: () => req<Template[]>("/v1/admin/templates"),
  saveTemplate: (t: Partial<Template>) =>
    req<Template>("/v1/admin/templates", { method: "POST", body: JSON.stringify(t) }),
  deleteTemplate: (id: string) =>
    req<void>(`/v1/admin/templates/${id}`, { method: "DELETE" }),
  listFoundryModels: () => req<string[]>("/v1/admin/foundry/models"),

  listCustomers: () => req<Tenant[]>("/v1/admin/customers"),
  saveCustomer: (c: Partial<Tenant>) =>
    req<Tenant>("/v1/admin/customers", { method: "POST", body: JSON.stringify(c) }),
  deleteCustomer: (orgId: string) =>
    req<void>(`/v1/admin/customers/${orgId}`, { method: "DELETE" }),

  listInstances: (orgId: string) =>
    req<Instance[]>(`/v1/admin/customers/${orgId}/instances`),
  saveInstance: (orgId: string, i: Partial<Instance>) =>
    req<Instance>(`/v1/admin/customers/${orgId}/instances`, {
      method: "POST",
      body: JSON.stringify(i),
    }),
  deleteInstance: (orgId: string, instanceId: string) =>
    req<void>(`/v1/admin/customers/${orgId}/instances/${instanceId}`, { method: "DELETE" }),

  getInstanceAgent: (orgId: string, instanceId: string) =>
    req<AgentInfo>(`/v1/admin/customers/${orgId}/instances/${instanceId}/agent`),
  toggleInstanceAgentTool: (orgId: string, instanceId: string, key: string, enabled: boolean) =>
    req<{ status: string }>(
      `/v1/admin/customers/${orgId}/instances/${instanceId}/agent/tools`,
      { method: "POST", body: JSON.stringify({ key, enabled }) }
    ),

  metering: (orgId: string) =>
    req<Metering>(`/v1/admin/customers/${orgId}/metering`),

  costs: () => req<CostSummary>("/v1/admin/costs"),

  uploadKnowledge: async (
    orgId: string,
    instanceId: string,
    title: string,
    source: string,
    file: File
  ) => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("source", source);
    fd.append("file", file);
    const res = await fetch(
      `${API_BASE}/v1/admin/customers/${orgId}/instances/${instanceId}/knowledge`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      }
    );
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
};
