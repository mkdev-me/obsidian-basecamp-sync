export { obsidianFetch as __basecampFetch } from './transport';

// Scoped SDK shims for WebViews predating AbortSignal.any/timeout. No global prototypes are modified.
export function __basecampAbortTimeout(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), milliseconds);
  return controller.signal;
}
export function __basecampAbortAny(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const handlers = new Map<AbortSignal, () => void>();
  const abort = (signal: AbortSignal) => {
    controller.abort(signal.reason);
    for (const [source, handler] of handlers) source.removeEventListener('abort', handler);
    handlers.clear();
  };
  for (const signal of signals) {
    if (signal.aborted) { abort(signal); break; }
    const handler = () => abort(signal);
    handlers.set(signal, handler);
    signal.addEventListener('abort', handler, { once: true });
  }
  return controller.signal;
}
