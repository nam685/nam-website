output "backend_dsn" {
  description = "Django SENTRY_DSN — add to Bitwarden Secrets Manager's nam-website-prod project"
  value       = data.sentry_key.backend_default.dsn.public
  sensitive   = true
}

output "frontend_dsn" {
  description = "Next.js DSN — add as the GitHub Actions repo secret SENTRY_DSN_FRONTEND"
  value       = data.sentry_key.frontend_default.dsn.public
  sensitive   = true
}
