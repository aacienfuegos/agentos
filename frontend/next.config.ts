import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // En producción Caddy enruta /api/* al backend antes de llegar a Next.js,
    // así que este rewrite solo tiene efecto en desarrollo (npm run dev).
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
