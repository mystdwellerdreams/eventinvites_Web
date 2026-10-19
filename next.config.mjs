/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API reuses the Express app in backend/src, so its dependencies have to
  // be traced into the server bundle alongside the Next runtime.
  outputFileTracingIncludes: {
    // Prisma resolves its query engine from node_modules; without this the
    // engine can be missing from the deployed function.
    '/api/**': ['./node_modules/.prisma/**/*', './node_modules/@prisma/client/**/*'],
  },
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  async rewrites() {
    return [
      {
        // Uploaded files are stored as /uploads/<name> and served by the Express
        // app, which now lives behind the /api catch-all. Declared here rather
        // than in vercel.json so it applies in local development too.
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*',
      },
    ]
  },
}

export default nextConfig