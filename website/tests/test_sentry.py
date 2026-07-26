from unittest.mock import patch

from website.sentry import init_sentry, scrub_event


class TestInitSentry:
    @patch("website.sentry.sentry_sdk.init")
    def test_noop_when_dsn_empty(self, mock_init):
        init_sentry("")
        mock_init.assert_not_called()

    @patch("website.sentry.sentry_sdk.init")
    def test_initializes_with_pii_disabled(self, mock_init):
        init_sentry("https://fake@o0.ingest.sentry.io/1")
        mock_init.assert_called_once()
        _, kwargs = mock_init.call_args
        assert kwargs["dsn"] == "https://fake@o0.ingest.sentry.io/1"
        assert kwargs["send_default_pii"] is False
        assert kwargs["before_send"] is scrub_event


class TestScrubEvent:
    def test_strips_authorization_header(self):
        event = {"request": {"headers": {"Authorization": "Bearer secret-token", "Accept": "application/json"}}}
        result = scrub_event(event, {})
        assert result["request"]["headers"]["Authorization"] == "[Filtered]"
        assert result["request"]["headers"]["Accept"] == "application/json"

    def test_strips_request_body(self):
        event = {"request": {"data": {"secret": "leak-me"}, "headers": {}}}
        result = scrub_event(event, {})
        assert "data" not in result["request"]

    def test_handles_event_with_no_request(self):
        event = {"message": "no request here"}
        result = scrub_event(event, {})
        assert result == {"message": "no request here"}
