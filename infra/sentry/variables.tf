variable "sentry_org" {
  description = "Sentry organization slug"
  type        = string
}

variable "sentry_team" {
  description = "Sentry team slug that owns these projects — find your org's default team slug under Sentry Settings > Teams (one is auto-created when the org is created)"
  type        = string
}
