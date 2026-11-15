# ChatGPT programming exchange

ChatGPT coaches; Athlete Lab validates, schedules and logs training. No in-app AI chat or separately billed OpenAI API is used. The immediately usable workflow is context export plus validated programme import, including offline use.

## Ordinary workflow

1. Programme → Share with ChatGPT: choose recent/upcoming periods and categories. Identity, sensitive recovery categories and notes require explicit inclusion. Missing or excluded information is reported as unknown, not zero.
2. Copy/download the context to your ChatGPT conversation. It distinguishes plans, actual results, recorded facts and missing information. Session/programme fingerprints support safe updates.
3. Give ChatGPT [programme.schema.json](programme.schema.json), or copy the example/full schema from Programme → Import programme. Ask for the athlete-lab-programme version-1 JSON envelope, one stable unique idempotencyKey, a title and changes.
4. Import, validate and inspect every activity and previous prescription. Check the separate approval box and final confirmation. Only this explicit action saves; imported text cannot approve itself.
5. Log actual performance and share updated context for future planning.

Changes support add, update and reschedule. New team activities can specify repeatUntil for weekly recurrence. Programme metadata can create a block; existing blocks require their ID and fresh expectedFingerprint. Each update/reschedule similarly requires targetId and fresh expectedFingerprint. Completed activities and historical workout records cannot be modified by imports. Rest days are explicit activities, not assumptions about blank dates. Up to 180 expanded activities and 1 MB per document are allowed, from today to one year ahead.

Repeated approved imports are recognised by receipts. Reusing a key for different contents, stale fingerprints, duplicate activities, broken relationships and unsupported fields are rejected before any write. Approval rechecks the preview against current data. Storage errors cannot partially apply an import. Full backups preserve the receipts.

## Shared service and direct tools

The advertised boundary has two tools, with schemas shared across adapters:

| Tool | Behaviour |
| --- | --- |
| get_coaching_context | Authenticated, user-scoped deterministic summary using selected dates/categories and granted sensitive-data permissions |
| submit_programme_changes | Validated immutable programme draft and review link; no training saved until first-party approval |

Core services live in src/programme-exchange.ts and src/coaching-context.ts. src/athlete-tools.ts applies authentication, permissions and shared domain validation; server/athlete-tool-handler.ts exposes the authenticated backend. Browser site tools and the existing remote MCP adapter reuse that service. Legacy internal operations remain for compatibility, but the advertised catalogue is deliberately limited to these two tools.

In Settings → Advanced connection settings → ChatGPT connection, sign in/connect the correct cloud account and select permissions. Grants expire after 24 hours; sensitive categories and notes default off. Draft creation has a separate opt-in. Check the distinct sharing-confirmation box before saving permissions. Revoke access to stop new calls. Proposed changes appear for review; rejection changes no training. OAuth tool clients cannot invoke first-party approval RPCs or bypass the tool service through raw sync access.

All requests verify authentication and owner scope/RLS. No arbitrary SQL or privileged browser credential is exposed. Notes/imported content are untrusted data. Immutable drafts, idempotency keys, expected revisions, atomic writes and an audit trail protect approval and concurrency. Pending drafts and access grants are cloud metadata outside training backups; approved training is backed up normally.

## Server setup

Apply migrations 001–007 in order, build with npm run build:edge and deploy only the athlete-tools Supabase Edge Function. Configure server secrets ATHLETE_APP_ORIGIN and ATHLETE_TOOL_ORIGINS with exact allowed origins, never a wildcard. Keep ATHLETE_MCP_ENABLED=false while remote access is deferred. The retired coach function and its dedicated credentials are not required.

## Adapter availability and limits

Browser site tools register only when the actual host exposes the supported API in a secure context. A normal browser, ChatGPT web/iOS app, or an installed desktop client must not be assumed to support them. The page reports capability; browser tests emulate it, which does not verify availability on the user's ChatGPT account. Localhost may qualify as a secure context on the same computer; plain LAN HTTP does not provide a public connection.

Remote MCP remains prepared but disabled. Its endpoint is the project's /functions/v1/athlete-tools/mcp route. Activation requires a separately verified eligible ChatGPT account/workspace, stable HTTPS app origin, Supabase OAuth configuration and consent redirects, an allowlisted OAuth client/resource audience, PKCE, the optional Supabase access-token hook, and actual cross-user/token validation. See supabase/optional/athlete_tool_oauth.sql for the existing hook and registry. Do not paste browser tokens into ChatGPT or enable a permissive anonymous endpoint. This refocus deliberately does not add hosting, OAuth setup or a speculative second implementation.

The local export/import workflow works in usable ChatGPT web or iOS conversations without direct tools. It does not automatically inherit a ChatGPT project, upload app data in the background, or grant an AI authority to approve writes. Physical-device and real ChatGPT connection verification must be reported separately from mocks.
