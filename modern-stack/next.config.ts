import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Disable ESLint during build for Docker
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable TypeScript checks during build for Docker
    ignoreBuildErrors: false,
  },
  output: "standalone",
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
};

export default nextConfig;
