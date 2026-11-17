/**
 * The CSP of docs/0-SECURITY.md §3. Production uses a per-request nonce with `strict-dynamic`, because
 * the App Router emits its bootstrap/flight payload as inline scripts; development keeps inline + eval
 * so HMR works. `worker-src` is what lets the pipeline run at all.
 */
const apiOrigin = (() => {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base || base.startsWith('/')) return '';
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
})();

export function contentSecurityPolicy({ nonce, dev }: { nonce?: string; dev: boolean }): string {
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce ?? ''}' 'strict-dynamic' 'wasm-unsafe-eval'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "worker-src 'self' blob:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
