import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // An import sends every row of a sheet in one request; the default 1 MB
    // stops at a few thousand rows.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
