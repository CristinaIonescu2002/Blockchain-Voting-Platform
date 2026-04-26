import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Webpack: stub fs pentru client-side bundle (sdk-core importă fs la top-level)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },

  // Turbopack: stub doar fs — path NU trebuie stubbed (Next.js îl folosește intern)
  turbopack: {
    resolveAlias: {
      fs: "./lib/empty-module.js",
    },
  },
};

export default nextConfig;
