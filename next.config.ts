import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Webpack configuration for WebAssembly and Web Workers support
  webpack: (config, { isServer }) => {
    // Enable WebAssembly support for whisper.cpp (whisper-turbo)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Support Web Workers (required by whisper-turbo)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
};

export default nextConfig;
