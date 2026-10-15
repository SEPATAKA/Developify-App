# Observability and notifications

[Documentation entry point](../README.md)

## Current state

Firebase is not used by the mobile app, admin dashboard, or backend. Auth,
application data, and private file storage use Supabase. Mobile analytics,
crash reporting, remote configuration, and performance tracing currently use
no-op adapters; no telemetry data is collected.

OneSignal is an independent optional push-notification integration. It only
initializes when `ONESIGNAL_APP_ID` is configured. Keep it explicitly empty
during local demo verification unless the matching OneSignal project and
platform setup are configured. Push delivery also requires a configured
backend `ONESIGNAL_APP_ID` and `ONESIGNAL_API_KEY`, plus a registered device.

## Future telemetry

Choose an approved provider and document the privacy/consent policy before
implementing collection. Track only stable, non-sensitive event labels; do not
send credentials, identity documents, personal data, or full route paths.
Keep observability separate from authentication, authorization, and business
decisions.
