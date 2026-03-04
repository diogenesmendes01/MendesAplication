/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Tree-shake named imports from these heavy packages
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@radix-ui/react-icons",
    ],
  },
  // Disable X-Powered-By header
  poweredByHeader: false,
};

export default nextConfig;
