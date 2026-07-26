from unittest.mock import patch

import pytest

from website.sentry import cron_checkin, init_sentry, scrub_event


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

    def test_strips_oauth_code_from_query_string(self):
        event = {"request": {"query_string": "code=secret-oauth-code&state=abc", "headers": {}}}
        result = scrub_event(event, {})
        assert result["request"]["query_string"] == "[Filtered]"

    def test_handles_event_with_empty_query_string(self):
        event = {"request": {"query_string": "", "headers": {}}}
        result = scrub_event(event, {})
        # Empty query_string is falsy, so it should not be replaced
        assert result["request"]["query_string"] == ""

    def test_handles_event_with_missing_query_string(self):
        event = {"request": {"headers": {}}}
        result = scrub_event(event, {})
        # Missing query_string should not cause crash and should not add one
        assert "query_string" not in result["request"]


class TestCronCheckin:
    @patch("website.sentry.sentry_sdk.crons.capture_checkin")
    def test_success_path_reports_in_progress_then_ok(self, mock_checkin):
        mock_checkin.return_value = "checkin-id-123"
        with cron_checkin("sync-prices"):
            pass

        assert mock_checkin.call_count == 2
        first_call, second_call = mock_checkin.call_args_list
        assert first_call.kwargs["monitor_slug"] == "sync-prices"
        assert first_call.kwargs["status"] == "in_progress"
        assert second_call.kwargs["monitor_slug"] == "sync-prices"
        assert second_call.kwargs["check_in_id"] == "checkin-id-123"
        assert second_call.kwargs["status"] == "ok"

    @patch("website.sentry.sentry_sdk.crons.capture_checkin")
    def test_error_path_reports_error_and_reraises(self, mock_checkin):
        mock_checkin.return_value = "checkin-id-456"
        with pytest.raises(ValueError, match="boom"):
            with cron_checkin("sync-prices"):
                raise ValueError("boom")

        assert mock_checkin.call_count == 2
        _, second_call = mock_checkin.call_args_list
        assert second_call.kwargs["check_in_id"] == "checkin-id-456"
        assert second_call.kwargs["status"] == "error"
