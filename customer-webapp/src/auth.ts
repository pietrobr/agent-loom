/**
 * Optional Microsoft Entra External ID (CIAM) sign-in for the customer chat.
 *
 * Activated only when a client id is present in the runtime config
 * (window.__AUTH_CLIENT_ID__, injected by env-config.js, or VITE_CUSTOMER_*
 * during local dev). When absent, the app stays in demo-switcher mode and this
 * module is a no-op — so the demo experience is unchanged.
 *
 * The customer's org_id is NOT chosen in the UI in production: it arrives as a
 * claim inside the External ID access token and the backend reads it.
 */
import {
  PublicClientApplication,
  type AccountInfo,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { setToken } from "./api";

const w = window as any;
const CLIENT_ID: string = w.__AUTH_CLIENT_ID__ || (import.meta as any).env?.VITE_CUSTOMER_CLIENT_ID || "";
const AUTHORITY: string = w.__AUTH_AUTHORITY__ || (import.meta as any).env?.VITE_CUSTOMER_AUTHORITY || "";
const API_SCOPE: string = w.__AUTH_API_SCOPE__ || (import.meta as any).env?.VITE_CUSTOMER_API_SCOPE || "";

export function authEnabled(): boolean {
  return Boolean(CLIENT_ID && AUTHORITY && API_SCOPE);
}

let msal: PublicClientApplication | null = null;
function client(): PublicClientApplication {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: AUTHORITY,
        // CIAM authorities use a *.ciamlogin.com host that is not in MSAL's
        // built-in trusted list, so declare it explicitly.
        knownAuthorities: [new URL(AUTHORITY).host],
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "localStorage" },
    });
  }
  return msal;
}

/** Sign the customer in (redirect flow) and cache an API access token. */
export async function ensureSignedIn(): Promise<void> {
  if (!authEnabled()) return;
  const pca = client();
  await pca.initialize();
  await pca.handleRedirectPromise();

  const account: AccountInfo | undefined = pca.getAllAccounts()[0];
  if (!account) {
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

/**
 * Sign out **locally**: clear the MSAL cache + our cached API token, but do NOT
 * navigate to the Microsoft logout page. The app then shows its own "signed out"
 * screen (so the user isn't bounced straight back to the login mask).
 */
export async function signOut(): Promise<void> {
  if (!authEnabled()) return;
  const pca = client();
  await pca.initialize();
  const account = pca.getActiveAccount() || pca.getAllAccounts()[0];
  try {
    await pca.logoutRedirect({
      account: account ?? undefined,
      onRedirectNavigate: () => false, // clear local session without leaving the SPA
    });
  } catch {
    /* best-effort: fall through to clearing our token */
  }
  setToken("");
}

/** Start a fresh interactive sign-in (used by the "Sign in again" link). */
export async function signIn(): Promise<void> {
  if (!authEnabled()) {
    window.location.reload();
    return;
  }
  const pca = client();
  await pca.initialize();
  // prompt:"select_account" forces the account picker so a different user can
  // sign in (a local logout doesn't clear the IdP SSO session, which would
  // otherwise silently sign the same user back in).
  await pca.loginRedirect({ scopes: [API_SCOPE], prompt: "select_account" });
}
