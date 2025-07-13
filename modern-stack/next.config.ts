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
  webpack: (config, { isServer }) => {
    // Fix matrix-js-sdk bundling issues
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    
    // Handle matrix-js-sdk properly
    config.externals = config.externals || {};
    if (isServer) {
      config.externals.push('matrix-js-sdk');
    }
    
    return config;
  },
};

export default nextConfig;
