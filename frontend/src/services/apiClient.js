// Base URL: the dev proxy (http://localhost:3001) locally, CloudFront in AWS.
// The FastAPI backend is the `api-service` Lambda: `${API_URL}/api/api-service/<path>`.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const API_BASE = `${API_URL}/api/api-service`;

export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields; // { fieldName: message } for validation errors (400)
  }
}

/** Turn the API's `errors` list ([{ loc: ['body', 'title'], msg }]) into { title: msg }. */
export function fieldErrors(errors) {
  const out = {};
  for (const e of Array.isArray(errors) ? errors : []) {
    // loc is e.g. ['body', 'title']; a bare ['body'] is about the whole request, not a field
    const field = Array.isArray(e?.loc) && e.loc.length > 1 ? e.loc.at(-1) : null;
    if (typeof field === 'string' && !out[field]) out[field] = String(e.msg ?? '').replace(/^Value error, /, '');
  }
  return out;
}

export function getToken() {
  return sessionStorage.getItem('token');
}

export function saveSession(token, user) {
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('user', JSON.stringify(user));
}

export function clearSession() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
}

// Called when any request comes back 401 (expired / invalid session)
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function toQuery(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    (Array.isArray(value) ? value : [value]).forEach((v) => qs.append(key, v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Seconds until the stored token expires (null if there is none or it can't be read). */
export function tokenSecondsLeft(token = getToken()) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp - Date.now() / 1000 : null;
  } catch {
    return null;
  }
}

// Renew the token quietly once less than this is left (tokens last 8 hours)
export const REFRESH_WHEN_SECONDS_LEFT = 60 * 60;
let refreshing = null; // one renewal at a time, shared by concurrent requests

/** Swap a token that is about to expire for a fresh one (the server caps a session at 24 h). */
async function refreshIfDue() {
  const left = tokenSecondsLeft();
  if (left === null || left <= 0 || left > REFRESH_WHEN_SECONDS_LEFT) return;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        saveSession(data.token, data.user);
      }
      // A refusal (e.g. the 24-hour limit) is fine: the request goes ahead with the
      // old token, and once that expires the usual 401 sends the user to sign in.
    } catch {
      // offline: try again on the next request
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
}

export async function apiRequest(path, { method = 'GET', body, params } = {}) {
  if (!path.startsWith('/auth/')) await refreshIfDue();
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}${toQuery(params)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }

  if (res.status === 204) return null;
  // On AWS, CloudFront answers every 404 with the app's own index.html and status 200
  // (its fallback for page URLs, which also catches the API). The API only ever sends
  // JSON, so an HTML page here is a 404 in disguise: report it as one.
  if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new ApiError(404, "Not found. It may have been removed, or it's no longer available to you.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const detail = typeof data.detail === 'string' ? data.detail : null;
    throw new ApiError(
      res.status,
      data.message || detail || 'Something went wrong. Please try again.',
      fieldErrors(data.errors),
    );
  }
  return data;
}
