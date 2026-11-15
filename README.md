# Athlete Lab

A mobile-first, local-first React + TypeScript training PWA built with Vite, Tailwind CSS and IndexedDB. ChatGPT is the coaching interface; Athlete Lab stores programmes, performed training and performance results. No account, backend or paid AI service is required for local use.

## Run locally

Use Node 22.12+ or Node 24. With NVM, select a compatible installed version, then run:

    npm install
    npm run dev

On Windows PowerShell, use npm.cmd if script execution is restricted. Open the printed localhost address, usually http://localhost:5173. An iPhone on the same Wi-Fi can open http://YOUR_COMPUTER_IP:5173 while the computer/server remains running. iPhone installation and service workers require HTTPS; plain LAN HTTP is a testing address.

Set VITE_APP_NAME in .env.local to rename the app. Its stable IndexedDB name stays athlete-lab so renaming does not discard data. Restart/rebuild after changing environment configuration. When updating an installed PWA, use Update now or refresh; do not clear browser storage to update the app.

## Four primary screens

- **Programme:** weekly calendar across the selected programme; add, edit, reschedule or duplicate sessions, manage separate programmes/blocks, share coaching context and import reviewed programming. Blank days are unscheduled, not assumed rest. Starter sessions are explicitly proposed, never completed history.
- **Training Log:** actual individual training, team attendance, matches and tests, with date/type filters and editable records. Log unplanned training without inventing a prior completed session.
- **Testing:** existing test catalogue, protocols, results, comparable personal bests and optional detailed match statistics. Blank measurements remain unknown. Definitions include their evidence and limitations.
- **Progress:** recorded consistency, duration and minutes × RPE, actual strength work, focused tests and skills/match trends. Unknown duration or effort is excluded from known totals and identified separately; no injury-risk or composite athlete score is calculated.

Open Settings from the athlete/avatar button for profile/goals, priorities, potential positions, equipment, preferences, constraints, appearance, backups and optional cloud sync. Skills history and optional recovery observations are secondary links in Training Log.

## Programming and logging

Individual sessions support gym strength, power, speed, conditioning, skills, tactical work, recovery and testing. A combined session can contain multiple training categories. Exercise prescriptions retain sets, repetitions/distance/time, recovery, tempo, RIR and coaching cues as entered. Choose reps, distance or duration for actual-result entry. Logged results are independent of prescriptions: unchecked sets are unperformed, blank results are unknown, and substitutions/notes can record changes. Historical prescription snapshots remain intact when future plans change.

**Team training** records local date, clock time, IANA time zone, club, training type, venue and planned attendance. Optional weekly recurrence materialises occurrences for up to one year. Edit one occurrence or this and subsequent regular occurrences; individually edited exceptions and logged occurrences are preserved. Cancel or reschedule a single occurrence without recreating the series. After training, record full/partial/missed attendance, actual duration and RPE; running, sprinting, technical observations and match-play minutes are optional. Planned attendance is not actual participation.

**Match fixtures** can be scheduled with opponent, type, venue and competition before statistics exist. Log participation, position, actual minutes, RPE and result after the fixture. This creates/updates a linked match record, not a duplicate workout load. Detailed shot and contribution statistics remain optional in Testing. Older unlinked match records retain their history; missing historical RPE is unknown and is not estimated.

**Skills** retain drill objectives, success criteria, foot, distance, angle, pressure, actual attempts and successes. Comparisons use matching conditions and weighted denominators, not arbitrary skill scores. **Recovery** remains optional self-reported availability, symptoms, illness and missed training. Missing observations do not mean symptom-free; the app provides no diagnosis or risk prediction.

## Use ChatGPT without an in-app chat

1. In Programme, choose Share with ChatGPT. Select the reporting periods/categories and explicitly choose whether to include identity, health observations or free-text notes. Preview and copy/download the deterministic context.
2. Give that context and [the programme JSON schema](docs/programme.schema.json) to your ChatGPT coaching conversation. Ask for an individual session, week or multiweek block. For changes, export fresh session IDs and expectedFingerprint values.
3. Choose Import programme. Paste the complete JSON or select a file up to 1 MB. Validation and preview do not change data.
4. Review all activities and prior prescriptions, check the separate approval box and confirm the final save. Reject leaves training unchanged. This works offline without signing in or calling an AI API.
5. Complete/log training normally and export updated context next time.

The import format is athlete-lab-programme version 1, separate from full backups. It supports add, update and reschedule, mixed-category sessions, programme blocks, team recurrence, fixtures and rest. Stable idempotency keys prevent repeated imports; reuse with different contents is rejected. Updates require current fingerprints and cannot change completed/historical training. A changed preview must be validated again. The repository saves the entire validated change atomically and detects stale concurrent tab edits.

The previous API chat, conversation/exchange persistence, usage limits and dedicated endpoint are retired. No OpenAI credential is needed. Your ChatGPT subscription/project is not automatically connected to Athlete Lab. Optional direct-tool adapters remain behind Settings → Advanced connection settings; see [integration boundaries and setup](docs/chatgpt-tools.md). Hosting/OAuth activation is deliberately deferred.

## Backup and restoration

Save open forms, then use Settings → Export all data (JSON), or Training Log → Export data. Keep copies outside this browser. Backups contain personal training/recovery records; auth tokens, passwords, cloud grants and pending integration drafts are excluded.

To restore, open Settings → Import backup (JSON), choose the original export (up to 25 MB), inspect its version, date and counts against current data, and export the current dataset if needed. Check the replacement confirmation and tap Restore backup. Cancel changes nothing. Full document and relationship validation happens before one atomic IndexedDB replacement. Failed storage writes preserve the prior dataset. Close other editing tabs before restoration.

Backups version 1, 2 and 3 migrate in memory to version 4 without fabricated history. Version 4 adds optional block/schedule/team/match/actual-result/profile fields and programme-import receipts; IndexedDB database/store versions remain unchanged. Update all devices before syncing or importing version-4 fields. Unsupported versions, unknown fields, missing sections and invalid relationships are rejected with an understandable error.

Restore replaces the currently open dataset, not every account branch. While connected, the replacement queues cloud additions/changes/deletions; signed out, it affects only original local records. Historical prescriptions and deleted-plan snapshots remain portable. Restoring is not a merge and has no undo, so retain the previous export.

## Optional Supabase sync

Use public VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY values in .env.local. Never put database passwords, service-role keys or API secrets in VITE_* or source control. Apply checked-in migrations 001–007 in order for a new database. Existing projects apply only missing migrations; migration 006 deliberately retires API-chat tables/functions, while 007 enables reviewed programme batches. Back up before schema maintenance. Do not reset an existing hosted database.

Configure Supabase Auth Site URL and redirect URLs for the actual app origin, plus email confirmation/recovery delivery. In Settings → Account & cloud sync, sign in, download a backup, review records and explicitly choose Upload local records or Open cloud records. Overlaps require review. Sign-out returns to the untouched original local branch; each account has a separate durable IndexedDB branch/outbox.

RLS isolates authenticated owners. Clients cannot write arbitrary table rows; revision-checked RPC batches derive ownership from the session and commit atomically. Tombstones prevent old devices resurrecting deleted rows. Independent edits merge; conflicting edits require explicit review. Offline edits remain available and retry on focus, reconnection and periodically while open. Browser storage is not encrypted. Do not clear storage with unsynced work.

## Verification

    npm run typecheck
    npm test
    npm run build
    npx playwright install chromium webkit
    npm run test:e2e

Tests cover validation, backups, migrations/RLS on embedded PostgreSQL, synchronisation, privacy, draft approval, recurrence, fixture workloads and programme imports. Playwright builds an isolated app with fake public cloud configuration on port 4173, testing desktop Chromium, mobile Chromium and mobile WebKit. The real dist build and your browser data are not used. Mobile WebKit emulation does not certify a physical iPhone. Browser binaries can be placed in .tools/browsers using PLAYWRIGHT_BROWSERS_PATH.

Live checks use two dedicated confirmed test users configured only in ignored .env.local: ATHLETE_TEST_EMAIL_A, ATHLETE_TEST_PASSWORD_A and B equivalents. Run npm run test:cloud:live and npm run test:tools:live. They use synthetic test records, test actual authentication/isolation/conflicts, and clean up training records while retaining protocol audit/tombstone records. Never run with the athlete's own account as a test account. No AI API requests are made.

For an offline/PWA check, build then run npm run preview -- --port 5173. Load once at a secure origin and test an offline reload. A running LAN server still requires the computer awake. Production HTTPS hosting, recovery-email delivery, physical-device sync and a real ChatGPT connection remain separate deployment checks.
