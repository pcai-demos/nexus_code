/**
 * Nexus Global Industries - Core session helpers (browser side).
 *
 * The session lives in the Nexus gateway's cookie, which the browser sends to every Nexus app, so
 * moving between apps never needs another sign-in. The app's own `/api/me` route (server side)
 * verifies the gateway's token and returns the profile. Nothing is kept in localStorage and no
 * token ever goes into a URL.
 *
 * Transitional (until every app is behind the Nexus gateway): if `/api/me` has no session, the old
 * `nxs_session` token (localStorage, or `?nxs_token=` from an older app) is still read so mixed
 * old/new apps keep working. Remove the `legacy*` parts once nexusapi's /auth/login is retired.
 */

const LEGACY_KEY = "nxs_session";
const LOGOUT_URL = process.env.NEXT_PUBLIC_NEXUS_LOGOUT_URL || "/oauth2/sign_out";

let sessionSource = null; // "gateway" | "legacy" | null

/**
 * Loads the signed-in user's profile.
 * @returns {Promise<object|null>} profile with `source`, or null when not signed in.
 */
export async function fetchSession() {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
    if (res.ok) {
      sessionSource = "gateway";
      clearLegacySession();
      return { ...(await res.json()), source: "gateway" };
    }
  } catch {
    // Fall through to the transitional session.
  }
  const legacy = legacySession();
  sessionSource = legacy ? "legacy" : null;
  return legacy;
}

/** Signs out of the gateway session (and Keycloak), or clears the transitional token. */
export function logout() {
  if (typeof window === "undefined") return;
  const wasGateway = sessionSource === "gateway";
  clearLegacySession();
  sessionSource = null;
  window.location.href = wasGateway ? LOGOUT_URL : "/";
}

/**
 * Link target for another Nexus app. Gateway sessions travel in the cookie, so the URL is
 * returned unchanged; only a transitional session appends the old token.
 * @param {string} url
 */
export function linkHref(url) {
  return sessionSource === "legacy" ? legacyAppendToken(url) : url;
}

// ── Transitional: pre-SSO token (remove when nexusapi's /auth/login is retired) ──────────

export function clearLegacySession() {
  if (typeof window !== "undefined") localStorage.removeItem(LEGACY_KEY);
}

/** Stores a token from an app's own (pre-SSO) login form; `fetchSession()` then reads it. */
export function saveLegacySession(token) {
  if (typeof window !== "undefined" && token) localStorage.setItem(LEGACY_KEY, token);
}

function legacyToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("nxs_token");
  if (fromUrl) {
    localStorage.setItem(LEGACY_KEY, fromUrl);
    params.delete("nxs_token");
    const search = params.toString();
    window.history.replaceState({}, document.title,
      window.location.pathname + (search ? `?${search}` : "") + window.location.hash);
    return fromUrl;
  }
  return localStorage.getItem(LEGACY_KEY);
}

function decodePayload(token) {
  try {
    let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  } catch {
    return null;
  }
}

function legacySession() {
  const token = legacyToken();
  const claims = token ? decodePayload(token) : null;
  if (!claims || (claims.exp && Date.now() / 1000 > claims.exp)) {
    clearLegacySession();
    return null;
  }
  return {
    username: claims.sub,
    user_id: claims.user_id ?? null,
    given_name: claims.given_name,
    full_first_name: claims.full_first_name,
    full_surname: claims.full_surname,
    email: claims.email,
    job_title: claims.job_title,
    base_site_id: claims.base_site_id,
    base_site: claims.base_site,
    avatar_url: claims.avatar_url,
    groups: [],
    source: "legacy",
  };
}

function legacyAppendToken(url) {
  const token = localStorage.getItem(LEGACY_KEY);
  if (!url || url === "#" || !token) return url;
  try {
    const target = new URL(url, window.location.href);
    const parent = window.location.hostname.substring(window.location.hostname.indexOf("."));
    if (target.hostname === window.location.hostname || target.hostname.endsWith(parent)) {
      target.searchParams.set("nxs_token", token);
      return target.toString();
    }
  } catch {
    // Leave the URL as it was.
  }
  return url;
}
