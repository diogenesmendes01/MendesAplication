/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Required in Next.js 14.x to enable the instrumentation.ts hook
    instrumentationHook: true,
    // Tree-shake named imports from these heavy packages
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@radix-ui/react-icons",
    ],
    // Packages used exclusively on the server (workers, queues, file processing).
    // Marking them as external prevents webpack from attempting to bundle native
    // addons and large server-only libs — they are resolved at runtime instead.
    serverComponentsExternalPackages: [
      "bullmq",
      "ioredis",
      "sharp",
      "pdf-parse",
      "mammoth",
      "xlsx",
      "tesseract.js",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling native addons and heavy server-only
      // packages that are lazy-loaded by BullMQ workers at runtime.
      // These are already present in node_modules and don't need bundling.
      const serverOnlyExternals = [
        'sharp',
        'pdf-parse',
        'mammoth',
        'xlsx',
        'tesseract.js',
        'bullmq',
        'ioredis',
      ];
      const originalExternals = config.externals ?? [];
      config.externals = [
        ...(Array.isArray(originalExternals) ? originalExternals : [originalExternals]),
        ({ request }, callback) => {
          if (serverOnlyExternals.includes(request)) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
  // Disable X-Powered-By header
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: '/configuracoes/agente-ia',
        destination: '/configuracoes/ai',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
