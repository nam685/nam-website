import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/draws", destination: "/yaps", permanent: true },
      { source: "/thinks", destination: "/yaps", permanent: true },
    ];
  },
};

export default nextConfig;
