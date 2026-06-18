/** Customer webapp API + SSE streaming client. */

export const API_BASE: string =
  ((window as any).__API_BASE__ ||
    (import.meta as any).env?.VITE_API_BASE ||
    "http://localhost:8000").replace(/\/$/, "");

const TOKEN_KEY = "agentloom_customer_token";

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t.trim());
}

/** Error carrying the HTTP status + optional machine code from the backend. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readError(res: Response, label: string): Promise<ApiError> {
  let code: string | undefined;
  let detail = "";
  try {
    const j = await res.json();
    code = j?.code;
    detail = j?.detail || "";
  } catch {
    /* non-JSON body */
  }
  return new ApiError(detail || `${label} (${res.status})`, res.status, code);
}

export interface BrandingResponse {
  product_name: string;
  primary_color: string;
  logo_url: string;
  tagline: string;
  partner_name: string;
  org_id: string;
  org_name: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
}

export interface DemoInstance {
  id: string;
  display_name: string;
  suggested_questions?: string[];
}
export interface DemoCustomer {
  org_id: string;
  name: string;
  instances: DemoInstance[];
}

/**
 * Demo-only: fetch the REAL customers (with their instances) from the backend
 * so the switcher reflects whatever was created in the Designer. Disabled in
 * production (returns 404), where the org_id comes from the Entra token.
 */
export async function fetchDemoCustomers(): Promise<DemoCustomer[]> {
  const res = await fetch(`${API_BASE}/v1/demo/customers`);
  if (!res.ok) throw new Error(`demo customers (${res.status})`);
  return res.json();
}

/**
 * Production: the signed-in customer's own chat instances, scoped server-side
 * by the org_id claim in their Entra External ID token (no switcher).
 */
export async function fetchMyInstances(): Promise<DemoInstance[]> {
  const res = await fetch(`${API_BASE}/v1/me/instances`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw await readError(res, "my instances");
  return res.json();
}

/**
 * Dev convenience: request a demo JWT from the backend (only works when the
 * backend has ALLOW_DEV_TOKENS=true). In production this is replaced by the
 * Entra External ID sign-in flow.
 */
export async function devLogin(orgId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ org_id: orgId, sub: `demo-${orgId}`, roles: [] }),
  });
  if (!res.ok) throw new Error(`dev-token failed (${res.status}). Is ALLOW_DEV_TOKENS=true?`);
  const j = await res.json();
  setToken(j.access_token);
  return j.access_token;
}

export async function fetchBranding(): Promise<BrandingResponse> {
  const res = await fetch(`${API_BASE}/v1/branding`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw await readError(res, "branding");
  return res.json();
}

export async function fetchCatalog(): Promise<CatalogItem[]> {
  const res = await fetch(`${API_BASE}/v1/catalog`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`catalog (${res.status})`);
  return res.json();
}

export interface ChatEvents {
  onMeta?: (m: any) => void;
  onToken?: (t: string) => void;
  onUsage?: (u: any) => void;
  onDone?: () => void;
  onError?: (msg: string, status?: number, code?: string) => void;
}

export interface ExtractedFile {
  filename: string;
  chars: number;
  truncated: boolean;
  text: string;
}

/**
 * Upload a document (PDF / DOCX / TXT / MD) and get its extracted plain text
 * back, so it can be attached into a chat message (e.g. a CV to evaluate).
 * Nothing is persisted server-side.
 */
export async function extractFile(file: File): Promise<ExtractedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/chat/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) throw await readError(res, "file upload");
  return res.json();
}

/**
 * Streams a chat completion via SSE. Uses fetch + ReadableStream because the
 * native EventSource API cannot send POST bodies or Authorization headers.
 */
export async function streamChat(
  body: { message: string; instance_id: string; conversation_id?: string },
  ev: ChatEvents,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let code: string | undefined;
    let detail = "";
    try {
      const j = JSON.parse(await res.text());
      code = j?.code;
      detail = j?.detail || "";
    } catch {
      /* non-JSON body */
    }
    ev.onError?.(detail || `chat failed (${res.status})`, res.status, code);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize CRLF -> LF so SSE records parse regardless of server line endings.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    // Parse complete SSE records separated by a blank line.
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      const data = dataLines.join("\n");
      switch (event) {
        case "meta":
          ev.onMeta?.(safeJson(data));
          break;
        case "token":
          ev.onToken?.(data);
          break;
        case "usage":
          ev.onUsage?.(safeJson(data));
          break;
        case "error":
          ev.onError?.(data);
          break;
        case "done":
          ev.onDone?.();
          break;
      }
    }
  }
  ev.onDone?.();
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
