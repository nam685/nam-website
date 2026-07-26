terraform {
  required_version = ">= 1.6"
  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "~> 0.15"
    }
  }
}

provider "sentry" {
  # Auth token sourced from the SENTRY_AUTH_TOKEN env var at apply time —
  # never hardcode it here. Get one from Sentry: Settings > Auth Tokens,
  # scoped to org:read, project:write, alerts:write.
}
