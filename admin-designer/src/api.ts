/**
 * Thin API client for the AgentLoom backend.
 *
 * Auth model for the SaaS Console: the provider's admin signs in with an admin
 * token. For the MVP we store an admin JWT in localStorage (minted by
 * `scripts/mint_demo_token.py _system admin-user admin` or issued by the
 * dev-token endpoint). Wire real Entra admin SSO in production.
 */

export const API_BASE: string =
  ((window as any).__API_BASE__ ||
    (import.meta as any).env?.VITE_API_BASE ||
    "http://localhost:8000").replace(/\/$/, "");

import { authEnabled, acquireApiToken } from "./auth";

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
 * is replaced by the provider admin Entra ID sign-in flow.
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
  // A stale/expired token returns 401. Transparently refresh once and retry:
  // in production via Entra ID (MSAL), in dev via the dev-token endpoint.
  if (res.status === 401 && !_retried) {
    try {
      if (authEnabled()) {
        await acquireApiToken();
      } else {
        await devAdminLogin();
      }
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
  agentic_retrieval?: boolean;
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
  agentic_retrieval?: boolean;
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
  embedding_tokens?: number;
  embedding_cost?: number;
  agentic_tokens?: number;
  agentic_cost?: number;
  search_cost: number;
  infra_cost: number;
  total_cost: number;
}
export interface CostMonth {
  month: string;
  token_cost: number;
  embedding_cost?: number;
  agentic_cost?: number;
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

// ---- Tracing ---------------------------------------------------------------
export type TraceLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface TraceSummary {
  id: string;
  org_id: string;
  ts: string;
  method: string;
  path: string;
  route?: string;
  status: number;
  duration_ms: number;
  level: TraceLevel;
  error?: { type: string; message: string } | null;
  user?: string;
  span_count?: number;
}
export interface TraceEvent {
  ts_ms: number;
  level: TraceLevel;
  message: string;
  attributes?: Record<string, unknown>;
}
export interface TraceSpan {
  id: string;
  parent_id?: string | null;
  name: string;
  start_ms: number;
  duration_ms: number;
  level: TraceLevel;
  status: "ok" | "error";
  attributes?: Record<string, unknown>;
  events?: TraceEvent[];
  error?: { type: string; message: string } | null;
}
export interface TraceDetail extends TraceSummary {
  spans: TraceSpan[];
  root_events?: TraceEvent[];
}
export interface TracingConfig {
  level: TraceLevel;
  levels: TraceLevel[];
}

export interface InfraConfig {
  app_insights_enabled: boolean;
  // Record prompt/response text on GenAI spans (privacy/cost sensitive).
  gen_ai_content_recording: boolean;
  // Whether the App Insights connection string is actually injected by infra.
  // When false the toggle has no effect until the next deploy wires it.
  app_insights_wired: boolean;
}

export interface DirectoryUser {
  id: string;
  display_name?: string;
  given_name?: string;
  surname?: string;
  upn?: string;
  mail?: string;
}
export interface UserPage {
  users: DirectoryUser[];
  next_skip_token?: string | null;
  error?: string;
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
  toggleInstanceAgentic: (orgId: string, instanceId: string, enabled: boolean) =>
    req<{ instance_id: string; agentic_retrieval: boolean }>(
      `/v1/admin/customers/${orgId}/instances/${instanceId}/agentic`,
      { method: "POST", body: JSON.stringify({ enabled }) }
    ),
  toggleInstanceAgentTool: (orgId: string, instanceId: string, key: string, enabled: boolean) =>
    req<{ status: string }>(
      `/v1/admin/customers/${orgId}/instances/${instanceId}/agent/tools`,
      { method: "POST", body: JSON.stringify({ key, enabled }) }
    ),

  metering: (orgId: string) =>
    req<Metering>(`/v1/admin/customers/${orgId}/metering`),

  // ---- Customer users (CIAM directory) — production only -------------------
  listCiamUsers: (opts: { search?: string; skipToken?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.search) p.set("search", opts.search);
    if (opts.skipToken) p.set("skip_token", opts.skipToken);
    if (opts.limit) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return req<UserPage>(`/v1/admin/ciam/users${qs ? `?${qs}` : ""}`);
  },
  createCiamUser: (body: {
    given_name?: string;
    surname?: string;
    upn: string;
    company?: string;
    org_id?: string;
  }) =>
    req<{ user: DirectoryUser; temp_password: string; added_to?: string | null }>(
      "/v1/admin/ciam/users",
      { method: "POST", body: JSON.stringify(body) }
    ),
  listGroupMembers: (orgId: string) =>
    req<DirectoryUser[]>(`/v1/admin/customers/${orgId}/group/members`),
  addGroupMember: (orgId: string, userId: string) =>
    req<{ status: string }>(`/v1/admin/customers/${orgId}/group/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  removeGroupMember: (orgId: string, userId: string) =>
    req<{ status: string }>(
      `/v1/admin/customers/${orgId}/group/members/${userId}`,
      { method: "DELETE" }
    ),

  costs: (currency?: string) =>
    req<CostSummary>(`/v1/admin/costs${currency ? `?currency=${encodeURIComponent(currency)}` : ""}`),

  // ---- Tracing -------------------------------------------------------------
  getTracingConfig: () => req<TracingConfig>("/v1/admin/tracing/config"),
  setTracingConfig: (level: TraceLevel) =>
    req<TracingConfig>("/v1/admin/tracing/config", {
      method: "PUT",
      body: JSON.stringify({ level }),
    }),
  listTraces: (params: {
    org_id?: string;
    exclude_system?: boolean;
    from?: string;
    to?: string;
    level?: string;
    limit?: number;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.org_id) q.set("org_id", params.org_id);
    if (params.exclude_system) q.set("exclude_system", "true");
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.level) q.set("level", params.level);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return req<TraceSummary[]>(`/v1/admin/traces${qs ? `?${qs}` : ""}`);
  },
  getTrace: (orgId: string, traceId: string) =>
    req<TraceDetail>(`/v1/admin/traces/${encodeURIComponent(orgId)}/${encodeURIComponent(traceId)}`),

  // ---- Infra ---------------------------------------------------------------
  getInfraConfig: () => req<InfraConfig>("/v1/admin/infra/config"),
  setInfraConfig: (patch: Partial<Pick<InfraConfig, "app_insights_enabled" | "gen_ai_content_recording">>) =>
    req<InfraConfig>("/v1/admin/infra/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

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
