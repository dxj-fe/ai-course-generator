import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
  serverExternalPackages: [
    "pdf-parse",
    "@napi-rs/canvas",
    "playwright",
    "playwright-core",
  ],
  outputFileTracingIncludes: {
    "/*": ["./src/server/prompts/templates/**/*.md"],
  },
};

export default nextConfig;
