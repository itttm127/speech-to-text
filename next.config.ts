import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Enable WebAssembly support for whisper-wasm
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    return config;
  },
};

export default nextConfig;
