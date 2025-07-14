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
    NEXT_PUBLIC_SIGNAL_INDOC_LINK: process.env.SIGNAL_INDOC_LINK,
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
    
    // Fix matrix-js-sdk multiple entrypoints issue
    config.resolve.alias = {
      ...config.resolve.alias,
      'matrix-js-sdk': require.resolve('matrix-js-sdk'),
      '@matrix-org/olm': require.resolve('@matrix-org/olm'),
    };
    
    return config;
  },
};

export default nextConfig;
