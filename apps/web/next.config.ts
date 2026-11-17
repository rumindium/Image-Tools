import type { NextConfig } from 'next';

/**
 * Security headers follow docs/0-SECURITY.md §3. The Content-Security-Policy itself is set per
 * request in `src/middleware.ts`, because it carries a nonce; everything else is static.
 * COOP/COEP are what enable SharedArrayBuffer for the AI lane (docs/0-PROCESSING-PIPELINE.md §7.2).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ri/contracts', '@ri/image-core', '@ri/image-browser', '@ri/presets', '@ri/ui'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
