export type AdminSession = {
  accessToken: string;
  admin: { id: string; email: string; name: string; role: string };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim();

function getApiUrl(path: string): string {
  if (!API_URL) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be configured to use the Developify API.',
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(API_URL);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL must be a valid absolute URL.');
  }
  const isLocalHttp =
    baseUrl.protocol === 'http:' &&
    (baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1');
  if (
    (baseUrl.protocol !== 'https:' && !isLocalHttp) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must use HTTPS (HTTP is allowed only for local development).',
    );
  }

  return `${baseUrl.toString().replace(/\/+$/, '')}${path}`;
}

export function getSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('developify.admin.session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function setSession(session: AdminSession) {
  localStorage.setItem('developify.admin.session', JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem('developify.admin.session');
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = getSession();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  const res = await fetch(getApiUrl(path), { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
