import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ie-ai-rulebook ships TypeScript source (no build step); Next must transpile it.
  transpilePackages: ["ie-ai-rulebook"],
};

export default nextConfig;
