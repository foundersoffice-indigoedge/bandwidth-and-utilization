import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ie-agent-rules ships TypeScript source (no build step); Next must transpile it.
  transpilePackages: ["ie-agent-rules"],
};

export default nextConfig;
