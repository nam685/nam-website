import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

// Must be NEXT_PUBLIC_ prefixed — Next.js only inlines that prefix into the
// client bundle at build time, so a plain SENTRY_DSN would never reach
// this file's runtime code.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// No-ops cleanly when unset (e.g. `pnpm dev` with no env var set): Sentry.init
// is simply never called, so every SDK call elsewhere (including
// onRouterTransitionStart below) becomes inert.
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,

    // Session Replay is intentionally NOT enabled: this app's /sudo login
    // page and GitHub/Google/Lichess OAuth callback flows must not risk
    // leaking tokens via recorded DOM/session data. No replayIntegration()
    // is registered below, and these sample rates are set to 0 as a
    // defense-in-depth guard against that changing by accident later.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
