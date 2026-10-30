/**
 * Nexus Global Industries - Core Authentication Utility
 * Manages JWT storage, extraction from URL parameters, decoding, and session state.
 */

/**
 * Saves the given JWT token to the browser's localStorage.
 * @param {string} token 
 */
export function saveToken(token) {
  if (typeof window !== "undefined") {
    localStorage.setItem("nxs_session", token);
  }
}

/**
 * Removes the JWT token from the browser's localStorage.
 */
export function clearSession() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("nxs_session");
  }
}

/**
 * Retrieves the token. First checks for a URL query parameter named `nxs_token`.
 * If found, saves it to localStorage and removes the parameter from the browser URL.
 * Otherwise, retrieves the token from localStorage.
 * @returns {string|null} The active token or null if not found.
 */
export function getToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get("nxs_token");

  if (tokenFromUrl) {
    localStorage.setItem("nxs_session", tokenFromUrl);
    
    // Remove the nxs_token parameter from the URL bar without reloading
    urlParams.delete("nxs_token");
    const newSearch = urlParams.toString();
    const newPath = window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash;
    window.history.replaceState({}, document.title, newPath);

    return tokenFromUrl;
  }

  return localStorage.getItem("nxs_session");
}

/**
 * Decodes the payload of a JWT token without external libraries.
 * @param {string} token 
 * @returns {object|null} The parsed payload or null if invalid.
 */
export function decodeToken(token) {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;

    let payload = parts[1];
    
    // Convert base64url to base64
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    
    // Add base64 padding if necessary
    const pad = payload.length % 4;
    if (pad) {
      payload += "=".repeat(4 - pad);
    }

    // Decode base64 to string handling escape/unicode characters, then parse as JSON
    const decoded = decodeURIComponent(escape(atob(payload)));
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

/**
 * Gets the current user session. Decodes token and validates expiration.
 * Clears session if expired.
 * @returns {object|null} Object containing user fields or null if invalid/expired.
 */
export function getUserSession() {
  const token = getToken();
  if (!token) return null;

  const decoded = decodeToken(token);
  if (!decoded) return null;

  const currentTime = Date.now() / 1000;
  if (decoded.exp && currentTime > decoded.exp) {
    clearSession();
    return null;
  }

  return {
    username: decoded.sub,
    given_name: decoded.given_name,
    full_first_name: decoded.full_first_name,
    full_surname: decoded.full_surname,
    email: decoded.email,
    job_title: decoded.job_title,
    base_site_id: decoded.base_site_id,
    base_site: decoded.base_site,
    avatar_url: decoded.avatar_url,
  };
}

/**
 * Appends the current JWT token (if present) to the given URL.
 * Only appends if the URL is absolute and targets a subdomain under our control.
 * @param {string} url The target URL.
 * @returns {string} The modified URL with nxs_token appended if appropriate.
 */
export function appendTokenToUrl(url) {
  if (!url || url === "#" || typeof window === "undefined") {
    return url;
  }
  const token = localStorage.getItem("nxs_session");
  if (!token) return url;

  try {
    const parsedUrl = new URL(url, window.location.href);
    const currentHost = window.location.hostname;
    
    // Check if local development on localhost
    const isLocal = (h) => h === "localhost" || h === "127.0.0.1";
    if (isLocal(parsedUrl.hostname) && isLocal(currentHost)) {
      parsedUrl.searchParams.set("nxs_token", token);
      return parsedUrl.toString();
    }

    // Check subdomains
    const dotIdx = currentHost.indexOf(".");
    if (dotIdx !== -1) {
      const parentDomain = currentHost.substring(dotIdx); // e.g. ".demo.lon-pcai.twlon.com"
      if (parsedUrl.hostname.endsWith(parentDomain) || parsedUrl.hostname === currentHost) {
        parsedUrl.searchParams.set("nxs_token", token);
        return parsedUrl.toString();
      }
    }
  } catch (e) {
    // Return original url if parsing fails
  }
  return url;
}
