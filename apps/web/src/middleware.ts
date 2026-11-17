import { type NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy } from './lib/csp';

/**
 * Next reads the nonce from the CSP request header and stamps it onto the scripts it renders, which
 * is the only way to keep `script-src` free of `'unsafe-inline'` in production (docs/0-SECURITY.md §3).
 * Pages therefore render per request; the cost is documented in the security doc.
 */
export function middleware(request: NextRequest): NextResponse {
  const dev = process.env.NODE_ENV !== 'production';
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy({ nonce, dev });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|theme.js).*)'],
};
