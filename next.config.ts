import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM; pg uses native-ish modules. Keep both out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  turbopack: { root: __dirname },
};

export default nextConfig;
