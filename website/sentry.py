import contextlib
from collections.abc import Iterator

import sentry_sdk
import sentry_sdk.crons


def init_sentry(dsn: str) -> None:
    """Initialize the Sentry SDK. No-ops if dsn is empty (e.g. local dev)."""
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        send_default_pii=False,
        before_send=scrub_event,
    )


def scrub_event(event: dict, hint: dict) -> dict:
    """Strip sensitive data before an event leaves this process for Sentry.

    This app carries admin tokens and OAuth client secrets in request
    headers/bodies/query strings that must never reach Sentry's servers.
    """
    request = event.get("request")
    if request:
        headers = request.get("headers")
        if headers and "Authorization" in headers:
            headers["Authorization"] = "[Filtered]"
        request.pop("data", None)
        if request.get("query_string"):
            request["query_string"] = "[Filtered]"
    return event


@contextlib.contextmanager
def cron_checkin(monitor_slug: str) -> Iterator[None]:
    """Report a Sentry Cron Monitor check-in around the wrapped block.

    No-ops safely if Sentry isn't configured (init_sentry was never called
    with a DSN) — sentry_sdk's check-in calls are inert without an active
    client, matching this module's DSN-optional design.
    """
    check_in_id = sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, status="in_progress")
    try:
        yield
    except Exception:
        sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, check_in_id=check_in_id, status="error")
        raise
    else:
        sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, check_in_id=check_in_id, status="ok")
