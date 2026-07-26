import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

// Same DSN var as sentry.server.config.ts / instrumentation-client.ts — see
// that file for why this isn't a plain SENTRY_DSN.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// No-ops cleanly when unset (e.g. local dev with no env var set).
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
}
