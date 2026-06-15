/**
 * Optional Microsoft Entra ID (workforce) sign-in for the SaaS Console.
 *
 * Activated only when a client id is present in the runtime config
 * (window.__AUTH_CLIENT_ID__, injected by env-config.js, or VITE_ADMIN_*
 * during local dev). When absent, the app stays in dev-token mode and this
 * module is a no-op — so the demo experience is unchanged.
 */
import {
  PublicClientApplication,
  type AccountInfo,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { setToken } from "./api";

const w = window as any;
const CLIENT_ID: string = w.__AUTH_CLIENT_ID__ || (import.meta as any).env?.VITE_ADMIN_CLIENT_ID || "";
const AUTHORITY: string = w.__AUTH_AUTHORITY__ || (import.meta as any).env?.VITE_ADMIN_AUTHORITY || "";
const API_SCOPE: string = w.__AUTH_API_SCOPE__ || (import.meta as any).env?.VITE_ADMIN_API_SCOPE || "";

export function authEnabled(): boolean {
  return Boolean(CLIENT_ID && AUTHORITY && API_SCOPE);
}

let msal: PublicClientApplication | null = null;
function client(): PublicClientApplication {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: window.location.origin },
      cache: { cacheLocation: "localStorage" },
    });
  }
  return msal;
}

/**
 * Ensure the user is signed in and an API access token is cached. Call once on
 * app start (before render) when authEnabled(). Uses the redirect flow.
 */
export async function ensureSignedIn(): Promise<void> {
  if (!authEnabled()) return;
  const pca = client();
  await pca.initialize();
  await pca.handleRedirectPromise();

  let account: AccountInfo | undefined = pca.getAllAccounts()[0];
  if (!account) {
    // Kicks off a redirect; the page reloads and resolves above next time.
    await pca.loginRedirect({ scopes: [API_SCOPE] });
    return;
  }
  pca.setActiveAccount(account);
  await acquireApiToken();
}

/** Acquire (silently, falling back to redirect) an API access token. */
export async function acquireApiToken(): Promise<string> {
  const pca = client();
  const account = pca.getActiveAccount() || pca.getAllAccounts()[0];
  if (!account) {
    await pca.loginRedirect({ scopes: [API_SCOPE] });
    return "";
  }
  try {
    const res = await pca.acquireTokenSilent({ account, scopes: [API_SCOPE] });
    setToken(res.accessToken);
    return res.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ account, scopes: [API_SCOPE] });
    }
    throw e;
  }
}

export async function signOut(): Promise<void> {
  if (!authEnabled()) return;
  await client().logoutRedirect();
}

/** The signed-in user's display name + username (email), when MSAL is active. */
export function currentUser(): { name?: string; username?: string } | null {
  if (!authEnabled() || !msal) return null;
  const acc = msal.getActiveAccount() || msal.getAllAccounts()[0];
  if (!acc) return null;
  return { name: acc.name, username: acc.username };
}
