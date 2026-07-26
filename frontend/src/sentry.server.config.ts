import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

// Not a plain SENTRY_DSN: this repo intentionally uses the single
// NEXT_PUBLIC_ prefixed var for client, server, and edge configs alike —
// Sentry DSNs aren't secret (they're designed to be embedded in client
// bundles), so there's no need for a server-only variant.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// No-ops cleanly when unset (e.g. local dev with no env var set): Sentry.init
// is simply never called, so every SDK call elsewhere becomes inert.
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  });
}
