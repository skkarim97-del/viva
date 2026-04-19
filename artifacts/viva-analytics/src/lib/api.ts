// ---------------------------------------------------------------- shared
// Single source of truth for the Viva Analytics API client. Every
// page hits /api/internal/* with the operator bearer key. The same key
// gates /viva-clinic's /internal pages, so users only enter it once
// per browser per product.
//
// The api-server lives at /api on the same origin (handled by the
// Replit artifact proxy via paths declared in artifact.toml), so we
// can use plain relative URLs without worrying about CORS.

export const KEY_STORAGE = "viva.internalKey";

export class ApiError extends Error {
  status: number;
  detail: string | undefined;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function apiGet<T>(
  path: string,
  key: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  });
  if (res.status === 401) {
    throw new ApiError("invalid_key", 401);
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(body.detail ?? "internal_metrics_disabled", 503, body.detail);
  }
  if (!res.ok) {
    throw new ApiError(`http_${res.status}`, res.status);
  }
  return (await res.json()) as T;
}
