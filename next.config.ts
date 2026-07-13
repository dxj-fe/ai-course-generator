import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./src/server/prompts/templates/**/*.md"],
  },
};

export default nextConfig;
