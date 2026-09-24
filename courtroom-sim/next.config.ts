import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Case files are read from disk by server components.
  outputFileTracingIncludes: { "/**": ["./data/cases/**"] },
};

export default nextConfig;
