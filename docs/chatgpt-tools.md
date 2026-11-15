# Athlete Lab coaching tools

ChatGPT is the coaching interface. Athlete Lab owns training records, deterministic summaries, validation and athlete approval. None of these tools calls OpenAI or requires OpenAI API credits. The earlier optional API chat remains available; it is not used by this integration. The Coaching Context export remains available offline.

## What is implemented

`src/athlete-tools.ts` is the protocol-independent service with typed arguments and shared JSON schemas. Browser site tools, JSON draft import and remote MCP all invoke it through the `athlete-tools` Edge Function. Existing domain, backup, historical snapshot, context and proposal validators are reused.

| Tool | Result |
| --- | --- |
| `get_athlete_profile` | Recorded sport, position and goals; unrecorded constraints remain unknown |
| `get_training_history` | Completed logs, actual duration/RPE, historical prescriptions and performed sets in an inclusive date range |
| `get_upcoming_sessions` | Uncompleted plans with session IDs, revisions and prescriptions |
| `get_training_programme` | Active programme and recorded planned work; no invented progression |
| `get_recovery_summary` | Only explicitly permitted symptom, illness and recovery categories |
| `get_performance_summary` | Tests and comparable trends using existing protocols |
| `get_football_performance` | Skills and match summaries, conditions and meaningful denominators |
| `get_coaching_context` | Concise comprehensive context with selected categories and separate recent/upcoming date windows |
| `get_workout_details` | One planned session or saved workout; historical prescriptions and actual results remain distinct |
| `propose_workout` | Validated immutable draft, review link, no calendar write |
| `approve_and_save_workout` | Approval status/review link; cannot manufacture user approval |
| `propose_workout_update` | Draft with before/after and expected session revision |
| `approve_workout_update` | Approval status/review link; cannot manufacture user approval |
| `log_completed_workout` | Draft of athlete-reported actual results; confirmation required before a log is saved |

Read ranges use `from` and `through` (inclusive, ISO dates), maximum 366 days. Completed-history windows cannot end in the future. `get_coaching_context` instead uses `recentFrom`, `recentThrough`, `upcomingFrom`, `upcomingThrough`, and `categories` (profile, programme, training, schedule, skills, testing, matches, recovery). `get_workout_details` accepts `{ "id": "session-or-workout-id" }`. It includes the current session revision where available. The tool catalog and exact draft schema are visible in ChatGPT Tools.

Actual running distances/timed efforts, equipment constraints and confirmed future fixtures are not separate fields in the current domain. They are reported as missing rather than inferred from prescriptions or past matches. Profile/goal text and shared notes may provide context but are athlete-entered, unverified data. Missing or excluded records never establish zero workload or symptom-free status. Results over 96 KB are rejected with a request to narrow the window/categories rather than silently truncated.

## Deploy the shared service

1. Existing migrations 001–004 must already be applied. Apply `supabase/migrations/202611150005_athlete_tools.sql`. It adds permissions, immutable drafts, a content-free write audit, and safeguards preventing OAuth tool tokens from bypassing the tool interface. It does not rewrite training data. Browser sync and the earlier approval RPC keep their signatures and remain supported.
2. Run `npm run build:edge` and `npx supabase functions deploy athlete-tools --remote=iquwuihqhzhzlvbizmdk --yes` with your own Supabase CLI login.
3. Set Supabase server secrets `ATHLETE_APP_ORIGIN` to your actual app origin (currently `http://localhost:5173`) and `ATHLETE_TOOL_ORIGINS` to the comma-separated allowed browser origins. Local examples: `http://localhost:5173,http://127.0.0.1:5173,http://192.168.0.11:5173`. Do not include `*`. HTTPS hosting is needed for remote access and non-localhost secure-context site tools.
4. Leave `ATHLETE_MCP_ENABLED` unset/false. Do not activate remote access until the separate OAuth checks below pass. No OpenAI secret is read by this function.
5. Build/run the app. Sign in, connect/synchronise the correct account, then open **ChatGPT Tools**. Save only the categories you approve, with separate sensitive-data opt-ins and optional draft creation. Permissions expire after 24 hours and can be revoked immediately.

## Immediately usable: ChatGPT desktop site tools (WebMCP)

Open Athlete Lab in the **ChatGPT desktop built-in browser**, sign in there and leave ChatGPT Tools open. Enable the selected permissions in the app. When supported, the page reports **Site tools registered** and the address bar lists 14 tools. Ask ChatGPT:

> Use Athlete Lab's get_coaching_context tool to review my recent training. Treat plans as plans, identify missing information, and ask before proposing changes. Stage a workout only when I request it. I will review and approve it in Athlete Lab.

Dates/categories must be supplied in the tool arguments. You can then ask for a specific workout's details and a validated draft. The page uses the same signed-in Supabase session and user-scoped data; no account credentials are handed to ChatGPT. The tools unregister when you leave the page, sign out or revoke access. Each invocation independently rechecks authentication and permission expiry on the server.

According to the [official site-tools documentation](https://learn.chatgpt.com/docs/webmcp), site tools are limited to the desktop built-in browser, secure contexts and supported models/account/workspace browser policies. `http://localhost` can be a secure context on the same computer; a plain LAN HTTP address generally is not. Feature detection is authoritative: normal Safari/Chrome and iPhone should not be assumed to support site tools. If unavailable, use the fallback below. Installation/account availability has not been established merely by registering tools in an automated test. The existing ChatGPT project is not automatically linked or transferred.

## Fallback on any usable ChatGPT plan

1. Export Coaching Context from Athlete Lab and provide it to your coaching conversation in ChatGPT.
2. In ChatGPT Tools, expand **Draft format and example**. Give ChatGPT the example and schema; ask it to return the same JSON envelope with an individualised prescription. Use today's UTC date for `today`, a stable unique `idempotencyKey`, and actual session IDs/revisions when requesting an update.
3. Paste the JSON into **Workout draft JSON**, or select its `.json` file. Save tool permissions with draft creation enabled, then select **Validate and preview draft**.
4. Review the complete before/after prescription. Check the separate approval box and approve in Athlete Lab. A second confirmation dialog protects the final save. Rejection changes only draft status.
5. Approved changes use the existing revision protocol and pull through the account's IndexedDB repository. Pending local changes/conflicts must be resolved first. Logging can also use the existing ordinary workout form with no AI connection.

Pasting/importing a draft never records a completed workout. A completion draft requires actual duration, session RPE, actual set results or skills attempts, and an independent statement that the athlete performed the work. Prescriptions are copied as historical snapshots, never converted into performed results. Existing completed workouts cannot be overwritten by tools. The integration currently stages one workout/update/log per draft; it does not create entire programme containers or bulk delete sessions.

## Remote MCP: prepared, disabled pending eligibility and OAuth

The endpoint is `https://iquwuihqhzhzlvbizmdk.supabase.co/functions/v1/athlete-tools/mcp`. It implements authenticated stateless JSON Streamable HTTP: initialize, ping, tools/list, tools/call, and notifications. GET returns 405 (no SSE stream); clients must accept JSON and event-stream as specified. OAuth protected-resource metadata and a WWW-Authenticate challenge support discovery. No unauthenticated athlete tools are exposed.

Do not paste Supabase browser access/refresh tokens into ChatGPT or use a service-role key for a connection. No anonymous mode is supported. Supabase's administrative MCP server is NOT this athlete-facing endpoint and should not be used as a substitute.

Before activating:

1. Confirm your account/workspace exposes **Add custom MCP server** (or its current equivalent). [OpenAI's current instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server) describe ChatGPT web → Plugins → plus → Add custom MCP server, OAuth configuration, creating/installing the plugin and invoking it with `@`. Workspace security restrictions apply. These docs do not establish eligibility for this particular Plus account; do not assume that a subscription guarantees the option or that every project permits the connection.
2. Provide a stable HTTPS Athlete Lab origin. Configure Supabase Auth Site URL/redirects accordingly, enable its OAuth 2.1 server and set its authorization path to `/oauth/consent`. The app implements the consent screen using Supabase's getAuthorizationDetails, approveAuthorization and denyAuthorization methods. It displays the actual verified client and requested scopes; opening the page alone grants no permission.
3. Register a dedicated OAuth client in Supabase, using the exact callback URI ChatGPT provides, PKCE and only necessary scopes. Prefer a manually registered client initially rather than enabling unrestricted dynamic client registration.
4. Apply `supabase/optional/athlete_tool_oauth.sql` once. Insert the approved client UUID and exact MCP resource URL into `athlete_tool_oauth_clients`. Register `athlete_tool_access_token_hook` as the Supabase Custom Access Token Hook. It adds this resource audience only for explicitly allowlisted clients and leaves ordinary sign-in tokens unchanged. Do not replace an existing custom hook without integrating its existing behaviour. Supabase's verified claims must include `client_id` and an `aud` containing the exact resource URL. Validate actual issued tokens and getUser/getClaims compatibility before enabling MCP.
5. Set `ATHLETE_MCP_CLIENT_IDS` to the same approved client UUID and only after those checks set `ATHLETE_MCP_ENABLED=true`. This enables your server endpoint; it does not install/activate a connection in ChatGPT by itself.
6. In ChatGPT add the MCP URL with **OAuth**, complete the recognised-client consent screen, install/enable the connection and test discovery plus a non-sensitive read. Then verify two-user isolation, revoked permissions, sensitive opt-ins, audience rejection and a draft/approval round trip before treating it as live.

OAuth tokens cannot read raw training/chat tables, call general sync, change tool permissions or approve drafts directly. The Edge first verifies the signed token, approved client and resource audience. Only then can its narrow server-only snapshot RPC read the verified subject's records; it checks the subject's active tool grant. The platform-independent service filters the response by category and sensitive-data permissions. Browser reads use the normal user JWT/RLS sync path. Server-only staging/snapshot access uses Supabase secrets and is never exposed as a client tool.

Write tools do not accept an approval flag or a bearer approval capability. `approve_*` returns status and a review link. Only the signed-in first-party app can call the separate approval RPC; OAuth clients are explicitly denied. Approval locks the account using the existing sync lock, checks expiry/current revisions/completion state, applies the change and inserts its audit event atomically. Retries cannot duplicate writes or audit approvals. Idempotency keys are scoped per account and input fingerprints reject conflicting reuse. The draft limit is 200/account/day; old drafts remain for audit rather than silently expiring from storage. Tools do not modify profile or health observations.

## Verification and remaining limits

Verified on 15 November 2026: the full unit/database suite passed 218 tests; the additional optional OAuth-hook test passed separately (219 distinct checks in total), and the changed tool-service tests were rerun successfully. All 72 browser tests passed across desktop Chromium, mobile Chromium and mobile WebKit. Type checking, the production/PWA build and the browser secret-marker scan passed. The existing nonfatal Vite large-chunk warning remains.

Migration 005 was applied and the athlete-tools function deployed to the configured Supabase project with remote MCP explicitly disabled. `npm run test:tools:live` passed real authentication, sensitive-data defaults, context retrieval, idempotent drafts, cross-account denial, explicit approval, duplicate protection and individual-session retrieval using dedicated test users. No completed workouts or OpenAI calls were created by this smoke test; its synthetic planned records were cleaned up, with revision tombstones and audit/draft entries retained. Existing live cloud/RLS/revision tests and the non-paid coaching boundary check also passed. The optional OAuth hook was tested in PostgreSQL but was not installed/enabled in the hosted Auth service.

Routine tests use mocks and embedded PostgreSQL, not paid AI calls. They exercise all adapters against the same service, real migrations, two-account access, OAuth raw-access denial, privacy, context accuracy, historical snapshots, validation, approval, logging, idempotency, stale writes and recovery. Browser tests emulate the WebMCP host; they do not prove actual ChatGPT account eligibility. A live service smoke test uses dedicated accounts only. Physical iPhone and real ChatGPT browser/client verification must be reported separately when actually performed.

Training JSON backup format/version and IndexedDB remain unchanged. Grants, pending tool drafts and audit entries are separate cloud records, not silently added to training backups; approved sessions/logs are included normally. Tool audit is content-free, but pending draft payloads contain prescriptions or reported results and must be treated as personal data. This section does not implement the later Phase 3C account-deletion/retention policy.
