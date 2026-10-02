/** JSON transport with a deadline covering headers and the complete response body. */
import { safeJsonParse } from '$shared/json';

export interface RequestIo {
  fetchFn?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;

export async function requestJson(
  path: string,
  init: RequestInit,
  timeoutId: string,
  io: RequestIo = {},
): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  const externalSignal = init.signal ?? undefined;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), io.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await (io.fetchFn ?? fetch)(`${io.origin ?? location.origin}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, data: safeJsonParse<unknown>(text, null) };
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(timeoutId, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}
