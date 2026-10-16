# Observability and notifications

[Documentation entry point](../README.md)

## Current state

Authentication, application data, and private file storage use Supabase.
Mobile analytics, crash reporting, remote configuration, and performance
tracing use no-op adapters; no telemetry data is collected. Remote push
notifications are not integrated. In-app notifications are loaded through
the authenticated API.

## Future telemetry

Choose an approved provider and document the privacy/consent policy before
implementing collection. Track only stable, non-sensitive event labels; do not
send credentials, identity documents, personal data, or full route paths.
Keep observability separate from authentication, authorization, and business
decisions. Any future remote notification provider requires an explicit
privacy/consent review and a provider that does not add a separate backend.
