import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mupdf ships a WebAssembly binary and is ESM-only with top-level await.
  // Bundling it breaks the WASM load, so leave it as a runtime require.
  serverExternalPackages: ['mupdf'],
};

export default nextConfig;
