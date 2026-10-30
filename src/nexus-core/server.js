/**
 * Nexus Global Industries - Core server helpers (route handlers only, never client code).
 *
 * Session: the Nexus gateway (oauth2-proxy) signs users in with Nexus Keycloak and forwards
 * `Authorization: Bearer <access token>`. The token is verified here against Keycloak's JWKS,
 * so a request that bypasses the gateway can't fake a user with headers.
 *
 * Reference data: Supabase REST (PostgREST) views in the `portal` schema. Until those exist,
 * it falls back to nexusapi's select endpoint (transitional; removed when nexusapi retires).
 *
 * Environment (server-side only):
 *   NEXUS_OIDC_ISSUER        https://nexus-sso.<domain>/realms/nexus  (unset: no gateway session)
 *   NEXUS_OIDC_JWKS_URL      in-cluster JWKS URL (default: <issuer>/protocol/openid-connect/certs)
 *   NEXUS_OIDC_AUDIENCE      expected `aud` (optional)
 *   NEXUS_SUPABASE_URL       http://supabase-supabase-kong.supabase.svc:8000 (unset: use nexusapi)
 *   NEXUS_SUPABASE_ANON_KEY  Supabase anon key (from a Kubernetes Secret)
 *   NEXUS_PORTAL_SCHEMA      default: portal
 *   NEXUS_API_URL            transitional fallback, default http://api.nexus-common.svc.cluster.local:8000
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = process.env.NEXUS_OIDC_ISSUER;
const JWKS_URL =
  process.env.NEXUS_OIDC_JWKS_URL || (ISSUER ? `${ISSUER}/protocol/openid-connect/certs` : null);
const AUDIENCE = process.env.NEXUS_OIDC_AUDIENCE;
const SUPABASE_URL = process.env.NEXUS_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXUS_SUPABASE_ANON_KEY;
const PORTAL_SCHEMA = process.env.NEXUS_PORTAL_SCHEMA || "portal";
const API_URL = process.env.NEXUS_API_URL || "http://api.nexus-common.svc.cluster.local:8000";

// Portal view -> legacy nexus table, for the transitional nexusapi fallback.
const LEGACY_TABLES = {
  navigation: "navbar_departments",
  sites: "sites",
  demo_info: "demo_info",
  ai_tools: "ai_tools_catalog",
};

const SAFE_VALUE = /^[A-Za-z0-9_.-]{1,64}$/;

let jwks = null;

/**
 * Maps verified OIDC claims to the profile shape the Nexus apps already use.
 * `given_name` stays the short name shown in greetings (Keycloak `nickname`);
 * the legal names are `full_first_name` / `full_surname`.
 * @param {Record<string, unknown>} c
 */
export function profileFromClaims(c) {
  return {
    username: c.preferred_username || c.username || c.sub,
    user_id: c.user_id ?? null,
    given_name: c.nickname || c.given_name || null,
    full_first_name: c.given_name || null,
    full_surname: c.family_name || null,
    email: c.email || null,
    job_title: c.job_title || null,
    role: c.role || null,
    department: c.department || null,
    base_site_id: c.base_site_id || null,
    base_site: c.base_site || null,
    avatar_url: c.picture || c.avatar_url || null,
    groups: Array.isArray(c.groups) ? c.groups : [],
  };
}

/**
 * Returns the signed-in user's profile from the gateway's bearer token, or null.
 * Throws if a token is present but invalid.
 * @param {Request} request
 */
export async function sessionFromRequest(request) {
  if (!ISSUER || !JWKS_URL) return null;
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  jwks ||= createRemoteJWKSet(new URL(JWKS_URL));
  const { payload } = await jwtVerify(match[1], jwks, {
    issuer: ISSUER,
    ...(AUDIENCE ? { audience: AUDIENCE } : {}),
  });
  return profileFromClaims(payload);
}

/**
 * Reads rows from a portal reference view.
 * @param {"navigation"|"sites"|"demo_info"|"ai_tools"} view
 * @param {{ eq?: Record<string, string>, columns?: string[], limit?: number }} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function readReference(view, { eq = {}, columns, limit } = {}) {
  for (const [column, value] of Object.entries(eq)) {
    if (!SAFE_VALUE.test(column) || !SAFE_VALUE.test(String(value))) {
      throw new Error(`Invalid filter ${column}=${value}`);
    }
  }

  if (SUPABASE_URL && SUPABASE_KEY) {
    const params = new URLSearchParams();
    params.set("select", columns?.length ? columns.join(",") : "*");
    for (const [column, value] of Object.entries(eq)) params.set(column, `eq.${value}`);
    if (limit) params.set("limit", String(limit));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Accept-Profile": PORTAL_SCHEMA,
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Supabase REST ${view}: HTTP ${res.status}`);
    return res.json();
  }

  // Transitional: nexusapi's read-only select endpoint, on its in-cluster address.
  const where = Object.entries(eq)
    .map(([column, value]) => `${column} = '${value}'`)
    .join(" AND ");
  const res = await fetch(`${API_URL}/database/tables/${LEGACY_TABLES[view]}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns: columns?.length ? columns : ["*"], where: where || null, limit }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`nexusapi ${view}: HTTP ${res.status}`);
  return (await res.json()).rows || [];
}
