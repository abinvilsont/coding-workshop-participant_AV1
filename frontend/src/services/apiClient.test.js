import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import {
  ApiError, apiRequest, fieldErrors, getToken, saveSession, setUnauthorizedHandler, tokenSecondsLeft,
} from './apiClient';

describe('apiRequest', () => {
  it('sends JSON with the bearer token and returns the parsed body', async () => {
    saveSession('tok-123', { id: 1 });
    const api = mockApi({ 'POST /incidents': (body) => ({ id: 9, ...body }) });

    const result = await apiRequest('/incidents', { method: 'POST', body: { title: 'Leak' } });

    expect(result).toEqual({ id: 9, title: 'Leak' });
    expect(api.calls[0].headers).toMatchObject({
      Authorization: 'Bearer tok-123',
      'Content-Type': 'application/json',
    });
  });

  it('builds query strings, repeating arrays and skipping empty values', async () => {
    const api = mockApi({ 'GET /incidents': { items: [], total: 0 } });
    await apiRequest('/incidents', { params: { status: ['open', 'assigned'], q: '', priority: null, limit: 20 } });
    const { query } = api.calls[0];
    expect(query.getAll('status')).toEqual(['open', 'assigned']);
    expect(query.has('q')).toBe(false);
    expect(query.has('priority')).toBe(false);
    expect(query.get('limit')).toBe('20');
  });

  it('returns null for 204 No Content', async () => {
    mockApi({ 'DELETE /incidents/4': { status: 204, body: null } });
    await expect(apiRequest('/incidents/4', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('throws ApiError with the server message and status', async () => {
    mockApi({ 'GET /incidents/99': { status: 404, body: { message: 'Incident not found.' } } });
    const err = await apiRequest('/incidents/99').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Incident not found.');
  });

  it('falls back to a friendly message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(apiRequest('/dashboard')).rejects.toThrow('Something went wrong. Please try again.');
  });

  it('treats the HTML page CloudFront sends in place of an API 404 as a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    })));
    const err = await apiRequest('/incidents/4/status', { method: 'POST', body: { status: 'on_hold' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/^Not found/);
  });

  it('reports network failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await apiRequest('/dashboard').catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('signs the user out on 401 only when they had a session', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockApi({ 'POST /auth/login': { status: 401, body: { message: 'Invalid email or password.' } },
              'GET /dashboard': { status: 401, body: { message: 'Your session has expired.' } } });

    await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toThrow('Invalid email');
    expect(onUnauthorized).not.toHaveBeenCalled(); // wrong password is not an expired session

    saveSession('old-token', { id: 1 });
    await expect(apiRequest('/dashboard')).rejects.toThrow('expired');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(() => {});
  });

  it('maps validation errors from the API onto fields', async () => {
    mockApi({ 'POST /incidents': { status: 400, body: {
      message: 'Please check the form.',
      errors: [
        { loc: ['body', 'title'], msg: 'Value error, Title is required.' },
        { loc: ['body', 'building_id'], msg: 'Input should be a valid integer' },
        { loc: ['body', 'title'], msg: 'second message for the same field is ignored' },
      ],
    } } });
    const err = await apiRequest('/incidents', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fields).toEqual({ title: 'Title is required.', building_id: 'Input should be a valid integer' });
  });

  it('has no field errors for other failures', () => {
    expect(fieldErrors(undefined)).toEqual({});
    expect(fieldErrors([{ loc: ['body'], msg: 'x' }, null])).toEqual({});
  });
});

/** A JWT-shaped token expiring in `seconds` (the signature isn't checked client-side). */
const tokenExpiringIn = (seconds, tag = 'a') => {
  const payload = btoa(JSON.stringify({ sub: '6', exp: Math.floor(Date.now() / 1000) + seconds }));
  return `h.${payload}.${tag}`;
};

describe('token refresh', () => {
  it('reads how long a token has left', () => {
    expect(tokenSecondsLeft(tokenExpiringIn(600))).toBeGreaterThan(590);
    expect(tokenSecondsLeft('not-a-jwt')).toBeNull();
    expect(tokenSecondsLeft(null)).toBeNull();
  });

  it('quietly renews a token that is about to expire, once for concurrent requests', async () => {
    saveSession(tokenExpiringIn(30 * 60, 'old'), { id: 6 });
    const fresh = tokenExpiringIn(8 * 3600, 'new');
    const api = mockApi({
      'POST /auth/refresh': { token: fresh, user: { id: 6, name: 'Emma' } },
      'GET /incidents': { items: [], total: 0 },
    });
    await Promise.all([apiRequest('/incidents'), apiRequest('/incidents')]);

    expect(api.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(getToken()).toBe(fresh);
    expect(api.calls.filter((c) => c.path === '/incidents').every((c) => c.headers.Authorization === `Bearer ${fresh}`)).toBe(true);
  });

  it('leaves a token with plenty of time alone', async () => {
    const token = tokenExpiringIn(5 * 3600);
    saveSession(token, { id: 6 });
    const api = mockApi({ 'GET /incidents': { items: [], total: 0 } });
    await apiRequest('/incidents');
    expect(api.calls.map((c) => c.path)).toEqual(['/incidents']);
  });

  it('carries on with the old token when renewal is refused or offline', async () => {
    const old = tokenExpiringIn(10 * 60);
    saveSession(old, { id: 6 });
    mockApi({
      'POST /auth/refresh': { status: 401, body: { message: 'Your session has reached its 24-hour limit.' } },
      'GET /incidents': { items: [], total: 0 },
    });
    await apiRequest('/incidents');
    expect(getToken()).toBe(old);

    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{"items":[],"total":0}', { status: 200 })));
    await expect(apiRequest('/incidents')).resolves.toEqual({ items: [], total: 0 });
  });
});

