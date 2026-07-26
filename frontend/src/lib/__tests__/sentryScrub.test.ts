import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { scrubSentryEvent } from "../sentryScrub";

// Minimal fabricated ErrorEvent/EventHint-shaped objects — only the
// `request` fields scrubSentryEvent actually reads/mutates are needed.
const hint = {} as EventHint;

function makeEvent(request: ErrorEvent["request"]): ErrorEvent {
  return { request } as ErrorEvent;
}

describe("scrubSentryEvent", () => {
  it("strips the Authorization header (case-insensitive) and leaves siblings untouched", () => {
    const event = makeEvent({
      headers: {
        Authorization: "Bearer secret-token",
        Accept: "application/json",
      },
    });

    const result = scrubSentryEvent(event, hint);

    expect(result.request?.headers?.Authorization).toBe("[Filtered]");
    expect(result.request?.headers?.Accept).toBe("application/json");
  });

  it("strips the Cookie header (case-insensitive)", () => {
    const event = makeEvent({
      headers: { cookie: "sessionid=abc123", Accept: "application/json" },
    });

    const result = scrubSentryEvent(event, hint);

    expect(result.request?.headers?.cookie).toBe("[Filtered]");
    expect(result.request?.headers?.Accept).toBe("application/json");
  });

  it("deletes request.cookies entirely when present", () => {
    const event = makeEvent({
      cookies: { sessionid: "abc123" },
    });

    const result = scrubSentryEvent(event, hint);

    expect(result.request).not.toHaveProperty("cookies");
  });

  it("deletes request.data entirely when present", () => {
    const event = makeEvent({
      data: { secret: "admin-token-in-body" },
    });

    const result = scrubSentryEvent(event, hint);

    expect(result.request).not.toHaveProperty("data");
  });

  it("filters request.query_string to [Filtered] when present and non-empty", () => {
    const event = makeEvent({
      query_string: "code=oauth-authorization-code&state=xyz",
    });

    const result = scrubSentryEvent(event, hint);

    expect(result.request?.query_string).toBe("[Filtered]");
  });

  it("leaves an absent/empty query_string alone", () => {
    const eventMissing = makeEvent({});
    const resultMissing = scrubSentryEvent(eventMissing, hint);
    expect(resultMissing.request?.query_string).toBeUndefined();
    expect(resultMissing.request).not.toHaveProperty("query_string");

    const eventEmpty = makeEvent({ query_string: "" });
    const resultEmpty = scrubSentryEvent(eventEmpty, hint);
    expect(resultEmpty.request?.query_string).toBe("");
  });

  it("handles an event with no request key at all, returning it unchanged", () => {
    const event = { message: "boom" } as ErrorEvent;

    const result = scrubSentryEvent(event, hint);

    expect(result).toEqual({ message: "boom" });
    expect(result.request).toBeUndefined();
  });
});
