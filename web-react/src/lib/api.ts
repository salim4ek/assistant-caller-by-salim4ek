const TOKEN_KEY = 'ac.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearAndRedirect() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('asm_name')
  localStorage.removeItem('asm_uid')
  sessionStorage.clear()
  location.href = '/'
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  // 401/403: surface the error, do NOT redirect — user keeps current view.
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = (data && (data as any).error) || (typeof data === 'string' ? data : 'HTTP ' + res.status)
    throw new ApiError(msg, res.status)
  }
  return data as T
}

export function decodeJWT<T = any>(token: string): T | null {
  try {
    const parts = token.split('.')
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}
