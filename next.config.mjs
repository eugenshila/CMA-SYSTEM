/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server for the Electron desktop package.
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  // Native Node packages used by server actions / route handlers
  serverExternalPackages: ['pg', 'pdfkit', 'exceljs', 'bcryptjs', 'qrcode'],
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
      allowedOrigins: ['*.e2b.app'],
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
