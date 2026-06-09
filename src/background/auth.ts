// OAuth via chrome.identity. Tokens live here, in the background, and never
// reach the content script / page.

import { apiError } from "../shared/utils";
import type { ApiError } from "../shared/types";

const PLACEHOLDER = "YOUR_OAUTH_CLIENT_ID";

/** True only when a real OAuth client id has been put in the manifest. */
export function isConfigured(): boolean {
  const oauth = chrome.runtime.getManifest().oauth2;
  const clientId = oauth?.client_id ?? "";
  return Boolean(clientId) && !clientId.startsWith(PLACEHOLDER);
}

/**
 * Get an OAuth token. `interactive` shows the Google consent UI; non-interactive
 * returns a cached token silently or throws if none exists.
 *
 * Throws a typed ApiError so callers can branch on the code.
 */
export async function getAuthToken(interactive: boolean): Promise<string> {
  if (!isConfigured()) {
    throw asApiError("AUTH_NOT_CONFIGURED");
  }
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    // Chrome may return a string (older) or { token } (newer typings).
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw asApiError("NOT_SIGNED_IN");
    return token;
  } catch (err) {
    throw classifyAuthError(err, interactive);
  }
}

/** Remove the cached token and best-effort revoke it server-side. */
export async function clearAuthToken(): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const result = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) return false;
    await chrome.identity.removeCachedAuthToken({ token });
    // Revoke so the next sign-in re-prompts consent cleanly.
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(
      () => undefined,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop a token Chrome believes is valid but the API rejected (401), so the next
 * getAuthToken fetches a fresh one.
 */
export async function invalidateToken(token: string): Promise<void> {
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch {
    /* ignore */
  }
}

function asApiError(code: ApiError["code"]): ApiError {
  return apiError(code, "");
}

function classifyAuthError(err: unknown, interactive: boolean): ApiError {
  if (err && typeof err === "object" && "code" in err) {
    return err as ApiError;
  }
  const msg = String((err as Error)?.message ?? err ?? "");
  if (/did not approve|access_denied|canceled|cancelled/i.test(msg)) {
    return apiError("AUTH_DENIED", "", msg);
  }
  // Non-interactive with no cached token is the common "not signed in" path.
  if (!interactive) return apiError("NOT_SIGNED_IN", "", msg);
  return apiError("AUTH_DENIED", "", msg);
}
