import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    resolveAlias: {
      canvas: { browser: "" },
    },
  },
  async redirects() {
    return [
      {
        source: "/study/:id",
        destination: "/review/:id",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
