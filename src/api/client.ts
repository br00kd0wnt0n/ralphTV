import { CONFIG } from '../config';

/**
 * Global 401 handler - clears token and reloads to login
 */
function handle401() {
  localStorage.removeItem('token');
  // Reload the page to force re-login
  window.location.href = '/';
}

/**
 * Get auth headers with token from localStorage or config
 */
export function authHeaders(): Record<string, string> {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Wrapper around fetch that handles 401 errors globally
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders(),
    },
  });

  // Handle 401 Unauthorized globally
  if (res.status === 401) {
    handle401();
    throw new Error('Session expired');
  }

  return res;
}

/**
 * Wrapper for JSON GET requests with 401 handling
 */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await apiFetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Wrapper for JSON POST requests with 401 handling
 */
export async function apiPost<T>(url: string, body?: any): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Wrapper for JSON PUT requests with 401 handling
 */
export async function apiPut<T>(url: string, body: any, headers?: Record<string, string>): Promise<T> {
  const res = await apiFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`PUT ${url} failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Wrapper for JSON PATCH requests with 401 handling
 */
export async function apiPatch<T>(url: string, body: any, headers?: Record<string, string>): Promise<T> {
  const res = await apiFetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`PATCH ${url} failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Wrapper for DELETE requests with 401 handling
 */
export async function apiDelete<T>(url: string): Promise<T> {
  const res = await apiFetch(url, {
    method: 'DELETE',
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`DELETE ${url} failed: ${res.status}`);
  }

  return res.json();
}
