import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Pin the workspace root so Next.js doesn't walk up the tree and find
  // an unrelated parent package-lock.json (matters in monorepo-like setups).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
