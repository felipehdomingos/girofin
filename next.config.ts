import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Azure App Service can start the minimal server without shipping the
  // complete development dependency tree.
  output: "standalone",
};

export default nextConfig;
