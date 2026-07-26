import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors from Server Components, Route Handlers, and middleware.
// No-ops safely when NEXT_PUBLIC_SENTRY_DSN is unset — with no active
// Sentry client (see sentry.server.config.ts / sentry.edge.config.ts),
// captureRequestError is inert.
export const onRequestError = Sentry.captureRequestError;
