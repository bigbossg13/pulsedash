// fetch() with a timeout that also honours the caller's AbortSignal, and
// errors that say which service failed.

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, signal, ...rest } = init
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status)
    try {
      return JSON.parse(text) as T
    } catch {
      // The FTC Events API sometimes answers with an HTML page instead of JSON.
      throw new HttpError(`Unexpected response from ${new URL(url).host}`, res.status)
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
