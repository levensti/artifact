import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Every /api route runs through src/proxy.ts (auth), and Next caps the
    // body it forwards past a proxy at 10MB by default, which truncated PDF
    // uploads and broke FormData parsing in /api/pdf-blobs. Raise it to
    // cover large papers and textbooks.
    proxyClientMaxBodySize: "100mb",
  },
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
