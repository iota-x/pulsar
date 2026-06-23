const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'w3z_token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Thin fetch wrapper that attaches the JWT and unwraps JSON / errors. */
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 401 on anything other than the auth endpoints means our token is
    // missing/expired/invalid — clear it and send the user back to /login
    // instead of surfacing a raw error in the UI.
    const isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/register');
    if (res.status === 401 && !isAuthCall && typeof window !== 'undefined') {
      tokenStore.clear();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    const message =
      body?.error ||
      (Array.isArray(body?.details) && body.details.map((d: any) => d.message).join(', ')) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}
