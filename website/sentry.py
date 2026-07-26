import sentry_sdk


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
