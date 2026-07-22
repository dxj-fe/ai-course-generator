import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/*": ["./src/server/prompts/templates/**/*.md"],
  },
};

export default nextConfig;
