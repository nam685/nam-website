import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/draws", destination: "/yaps", permanent: true },
      { source: "/thinks", destination: "/yaps", permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Source map upload to Sentry (requires org/project/an auth token wired
  // into CI) is out of scope for this task — see the "App-side wiring"
  // section of docs/superpowers/specs/2026-07-26-uptime-error-monitoring-design.md.
  // Disabling it keeps local/CI builds free of warnings about missing
  // org/project/auth-token config; error events still work fine without it,
  // just with unminified stack traces until source maps are wired up later.
  sourcemaps: {
    disable: true,
  },
  silent: true,
  telemetry: false,
});
