/**
 * Nexus Global Industries - Core session helpers (browser side).
 *
 * The session lives in the Nexus gateway's cookie, which the browser sends to every Nexus app, so
 * moving between apps never needs another sign-in. The app's own `/api/me` route (server side)
 * verifies the gateway's token and returns the profile. Nothing is kept in localStorage and no
 * token ever goes into a URL.
 */

const LOGOUT_URL = process.env.NEXT_PUBLIC_NEXUS_LOGOUT_URL || "/oauth2/sign_out";
// Left behind by the pre-SSO login (nexusapi /auth/login, retired 2026-10-30); removed on sight.
const RETIRED_TOKEN_KEY = "nxs_session";

/**
 * Loads the signed-in user's profile.
 * @returns {Promise<object|null>} profile, or null when there is no gateway session.
 */
export async function fetchSession() {
  if (typeof window === "undefined") return null;
  localStorage.removeItem(RETIRED_TOKEN_KEY);
  try {
    const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
    if (res.ok) return { ...(await res.json()), source: "gateway" };
  } catch {
    // No session: the caller decides what to show.
  }
  return null;
}

/** Signs out of the gateway session (and Keycloak). */
export function logout() {
  if (typeof window === "undefined") return;
  window.location.href = LOGOUT_URL;
}

/**
 * Link target for another Nexus app. The session travels in the gateway's cookie, so the URL is
 * returned unchanged; kept so links have one place to change.
 * @param {string} url
 */
export function linkHref(url) {
  return url;
}
