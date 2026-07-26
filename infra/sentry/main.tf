resource "sentry_project" "backend" {
  organization  = var.sentry_org
  teams         = [var.sentry_team]
  name          = "nam-website-backend"
  slug          = "nam-website-backend"
  platform      = "python-django"
  default_rules = false
}

resource "sentry_project" "frontend" {
  organization  = var.sentry_org
  teams         = [var.sentry_team]
  name          = "nam-website-frontend"
  slug          = "nam-website-frontend"
  platform      = "javascript-nextjs"
  default_rules = false
}

resource "sentry_uptime_monitor" "api_health" {
  organization     = var.sentry_org
  project          = sentry_project.backend.slug
  name             = "Django API health"
  environment      = "production"
  url              = "https://nam685.de/api/health/"
  method           = "GET"
  interval_seconds = 300
  timeout_ms       = 5000

  assertion_json = provider::sentry::assertion(
    provider::sentry::op_and(
      provider::sentry::op_status_code_check("greater_than", 199),
      provider::sentry::op_status_code_check("less_than", 300),
    )
  )
}

resource "sentry_uptime_monitor" "homepage" {
  organization     = var.sentry_org
  project          = sentry_project.frontend.slug
  name             = "Homepage"
  environment      = "production"
  url              = "https://nam685.de/"
  method           = "GET"
  interval_seconds = 300
  timeout_ms       = 5000

  assertion_json = provider::sentry::assertion(
    provider::sentry::op_and(
      provider::sentry::op_status_code_check("greater_than", 199),
      provider::sentry::op_status_code_check("less_than", 300),
    )
  )
}

resource "sentry_cron_monitor" "sync_prices" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug

  # This name is chosen to already be a valid slug (lowercase, hyphenated).
  # website/management/commands/sync_prices.py's check-in call uses this
  # exact string as monitor_slug — see Global Constraints note on verifying
  # this against the real apply.
  name = "sync-prices"

  checkin_margin_minutes  = 30
  failure_issue_threshold = 1
  max_runtime_minutes     = 15
  recovery_threshold      = 1

  schedule = {
    crontab = "0 6 * * *" # matches infra/sync-prices.timer's OnCalendar
  }

  timezone = "UTC"
}

resource "sentry_issue_alert" "backend_new_issue_email" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug
  name         = "Email on new issue"

  action_match = "any"
  filter_match = "any"
  frequency    = 30

  conditions_v2 = [
    { first_seen_event = {} },
    { regression_event = {} },
  ]

  actions_v2 = [
    {
      notify_email = {
        target_type      = "IssueOwners"
        fallthrough_type = "ActiveMembers"
      }
    }
  ]
}

resource "sentry_issue_alert" "frontend_new_issue_email" {
  organization = var.sentry_org
  project      = sentry_project.frontend.slug
  name         = "Email on new issue"

  action_match = "any"
  filter_match = "any"
  frequency    = 30

  conditions_v2 = [
    { first_seen_event = {} },
    { regression_event = {} },
  ]

  actions_v2 = [
    {
      notify_email = {
        target_type      = "IssueOwners"
        fallthrough_type = "ActiveMembers"
      }
    }
  ]
}

data "sentry_key" "backend_default" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug
  first        = true
}

data "sentry_key" "frontend_default" {
  organization = var.sentry_org
  project      = sentry_project.frontend.slug
  first        = true
}
