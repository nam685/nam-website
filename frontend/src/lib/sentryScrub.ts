import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Strip sensitive data before an event leaves this process for Sentry.
 *
 * Mirrors website/sentry.py's scrub_event on the backend: this app carries
 * admin tokens and OAuth authorization codes in request headers/cookies/
 * bodies/query strings (e.g. the /sudo login flow and the GitHub/Google/
 * Lichess OAuth callbacks) that must never reach Sentry's servers.
 */
export function scrubSentryEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent {
  const request = event.request;
  if (request) {
    if (request.headers) {
      for (const key of Object.keys(request.headers)) {
        if (
          key.toLowerCase() === "authorization" ||
          key.toLowerCase() === "cookie"
        ) {
          request.headers[key] = "[Filtered]";
        }
      }
    }
    delete request.cookies;
    delete request.data;
    if (request.query_string) {
      request.query_string = "[Filtered]";
    }
  }
  return event;
}
