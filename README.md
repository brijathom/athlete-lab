# Athlete Lab

A mobile-first, local-first React + TypeScript training PWA. Built with Vite, Tailwind CSS, IndexedDB (`idb`) and a generated Workbox service worker. No backend, account, subscription or AI integration is required.

## Direct ChatGPT tools

ChatGPT is the primary coaching interface. Open **ChatGPT Tools** for explicit data-sharing permissions, browser site tools, validated workout JSON import, reviewed drafts and the write audit trail. These tools do not call OpenAI and do not require OpenAI API billing. The earlier optional AI Coach remains available while the new connection is verified.

See [connection steps, tool reference, security boundaries and limitations](docs/chatgpt-tools.md). The shared service provides 14 operations, including comprehensive coaching context and individual workout details. Remote MCP is disabled by default until account eligibility and OAuth are verified; supported ChatGPT desktop site tools and validated import reuse the same implementation.

## Phase 3B: authenticated AI coaching

AI Coach is an independent OpenAI API experience. It does not inherit ChatGPT conversations or subscription access. Local training, backups and Coaching Context exports continue working without AI, an account or internet access.

### Server setup (required for live AI)

1. Apply `supabase/migrations/202611140002_coaching_chat.sql`, then `supabase/migrations/202611140003_coaching_proposals.sql`, then `supabase/migrations/202611150004_coaching_message_length.sql` in your existing Supabase project's SQL Editor, or through the CLI migration workflow. These add separate RLS-protected conversations, turns, proposals and content-free usage accounting; they do not rewrite training records or IndexedDB data. Stage 3B.1 was separately verified before Stage 3B.2; its recovery checkpoint is `.tools/checkpoints/stage-3b1-verified.zip`.
2. In Supabase **Edge Functions → Secrets**, set `OPENAI_API_KEY` from your OpenAI API project. Keep the credential exclusively in Supabase secrets. Configure API billing and a project spending budget in OpenAI; ChatGPT subscription access is not an API credential. Never place the key in `.env.local`, `VITE_*`, chat messages, browser code or version control.
3. Set server secrets `OPENAI_MODEL=gpt-6.1-sol` and `COACH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.0.11:5173` for local testing. Replace/add the actual HTTPS app origin when appropriate. Model access is verified using OpenAI's model endpoint before generation; unsupported or inaccessible configurations return a clear error. The model is configurable without a browser rebuild. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).
4. With the Supabase CLI installed, run `supabase login`, `npm run build:edge`, then `supabase functions deploy coach --project-ref iquwuihqhzhzlvbizmdk`. The checked-in function configuration disables only the gateway's legacy JWT check; the handler verifies every request with Supabase Auth `getUser` before any data access. The CLI needs your Supabase account authorisation; a publishable browser key cannot deploy functions.
5. Sign in to Athlete Lab, link/synchronise your records, then open **AI Coach**. Review sharing controls and the authorised context preview, enter a question and explicitly confirm sharing. Do not claim live AI verification until a configured project returns a successful answer.

### Data sharing, retention and controls

The server loads training through the authenticated user's RLS-scoped client and reuses the deterministic context generator. It never trusts client-supplied athlete data or user IDs. The preview comes from cloud records; fresh authorised records are loaded before each answer. Unsynchronised edits are excluded, and the UI requires a connected account without pending changes or unresolved conflicts.

Integrated coaching replaces export-only instructions with its actual cloud access and approval boundaries. Session IDs identify the same plan referenced in programme and schedule summaries; repeated displays alone do not establish duplicate records. Background reported in chat remains self-reported conversation context and does not automatically update profile details, recovery observations or completed workout logs. Standalone Coaching Context exports retain their existing wording and default fields.

Sharing supports 7/14/28/90 days of recent history, 7/14/28 upcoming days, and independent module selections. Names, symptoms, illness, recovery observations and free-text notes are separate opt-ins, off by default. Your question, goals, session titles and other selected text can themselves contain sensitive information; review before sending. Prior turns are replayed only when their sharing scope exactly matches the current settings. A narrower scope never automatically includes earlier health-sharing turns. At most six prior turns within the selected recent-history period and an 8 KB history budget are sent, with their original timestamps.

Answers separate recorded facts, interpretations and unknown information. Athlete notes/imported records are treated as untrusted data in server instructions; no tools, executable data or automatic training writes are available to the advice endpoint. OpenAI requests use the Responses API with strict structured output and `store:false`. Context snapshots are not retained in conversation tables; questions/answers and scope selections remain until conversation deletion. OpenAI's own API processing/retention policies still apply; `store:false` is not a promise of zero provider retention.

Conversation history lists conversations rather than individual messages. Selecting one opens all saved exchanges, moves focus to its transcript and shows the exchange count; load failures are brought into view and leave the previous conversation intact. History also supports deletion and a separate JSON export. Deleting a conversation removes its turns. Content-free rate-limit entries older than seven days are pruned when the next coaching request begins. Training backups remain version 3 and do not contain conversations; coaching exports are separate archival JSON, not training-restoration backups. Conversation history requires connectivity and is not cached as sensitive offline content.

Defaults are six requests/hour and twenty/day per account, a 500,000-token conservative daily reservation, and shared limits of 100 requests/3,000,000 reserved tokens/day. Reservations are enforced atomically in PostgreSQL before a paid call and retained even after timeouts/deletion, preventing quota bypass. UTF-8 request/context/history sizes and output tokens are capped. `COACH_*` server secrets in `supabase/functions/.env.example` configure limits; Review OpenAI billing and budget alerts separately; application token/request limits do not promise a fixed monetary cap. Failed/unknown in-flight requests use stable request IDs to prevent automatic duplicate calls. Conversation length is capped at 100 turns; start another conversation afterward.

### Stage 3B.2: review and approve programming

Select **Request a structured training proposal** before sending a question. The server supplies only eligible upcoming, uncompleted session targets from the selected active programme. The model may return a proposal or explain why more information is needed. Drafts support session additions, prescription/drill changes, date changes and removal of planned sessions. Planned skills and testing use the existing session/exercise models; no actual attempts, test results or completed workouts are created. Programme metadata, clinical observations, profiles and historical workouts are outside the proposal write surface.

Every proposal is validated against the existing complete-document and session validators before it is saved/displayed. The preview shows **Before** and **After approval**, with exercise sets, prescriptions, rest and skill details. Nothing appears in training until you check the separate approval confirmation and choose **Approve and save changes**. **Reject proposal** changes only proposal status. Existing notes excluded from sharing are preserved when updating their sessions/exercises.

Drafts expire after 24 hours and capture programme, preference and session revisions. Approval independently verifies the signed user, current data and session completion state, then uses a PostgreSQL transaction with the same account advisory lock as Phase 3A sync. Any stale revision or new workout completion rejects the whole change set. An already-decided proposal returns its status without applying twice. Approved rows enter the existing cloud records/revision protocol and the client pulls them through the existing IndexedDB sync repository. Pending local changes/conflicts must be resolved before UI approval. Deleting a conversation deletes its proposal history; already-approved planned sessions remain part of training.

### Live verification

Verified against the deployed Supabase service on 15 November 2026: authenticated access, two-account isolation, denied direct conversation creation, real OpenAI Responses using `gpt-6.1-sol`, conversation persistence, structured proposal generation, explicit approval and duplicate-action protection all passed. The successful run made two paid model requests using dedicated test accounts and cleaned up its temporary conversation and plans. Physical iPhone verification is still outstanding.

After migrations, secrets and deployment, use the two dedicated confirmed test users already configured in the ignored root `.env.local`:

```sh
npm run test:coach:live
```

This checks the deployed auth boundary, authenticated access, cross-account RLS reads and denied direct conversation creation without calling OpenAI. To explicitly authorise **two paid Responses requests**, conversation persistence/isolation, proposal generation and approval verification:

```sh
npm run test:coach:live -- --allow-paid
```

Use only dedicated test accounts. If account A has no live cloud records, the paid check temporarily seeds clearly labelled proposed plans with **zero actual workouts, tests or health records**. It requests an additional session, refuses to approve any model-proposed edit/removal of existing sessions, verifies explicit confirmation and duplicate approval protection, then deletes its conversation and newly created plans. Protocol tombstones and content-free quota entries remain. The script reads no OpenAI credential and does not print account credentials or athlete records. No live AI verification is claimed until this command succeeds against configured services. Physical iPhone testing remains manual.

Coaching questions support up to 8,000 characters, with a visible counter. Longer pasted text is preserved for editing and cannot be sent until shortened; it is never silently truncated. Existing deployments must apply migration `202611150004_coaching_message_length.sql` and redeploy the function before using longer messages.

Replies are buffered until their structured response validates; token streaming is not implemented. Routine tests use deterministic mocks and embedded PostgreSQL; they do not make paid API calls. Server sources are in `server/`, shared pure models in `src/coach-domain.ts`, and `npm run build:edge` creates the deployable Deno wrapper plus bundled `handler.js`. The frontend build never imports server code or API secrets.

## Phase 3A: optional Supabase accounts and cloud synchronisation

The local Phase 3A implementation adds email/password accounts, email recovery, durable per-account IndexedDB branches, explicit first-connection migration, offline change tracking, revision-checked cloud synchronisation, deletion markers and conflict review. Live Supabase verification requires the setup below. Phase 3B adds the separate authenticated API coaching service described above; Phase 3C production deployment has not started. Coaching Context remains a local export tool.

### Minimal hosted setup

1. Create a Supabase project. In its SQL Editor, execute `supabase/migrations/202611140001_cloud_sync.sql` **once**, or apply it through the Supabase CLI migration workflow. Keep subsequent schema changes in new migration files.
2. In Authentication → URL Configuration, set Site URL to your app origin and add its `/` URL to the allowed redirects. For local desktop development use `http://localhost:5173/`. Use HTTPS for iPhone authentication redirects and recovery; a LAN HTTP preview is not a production auth/PWA origin. Enable email confirmation and configure a production SMTP sender before release.
3. Add these **public** values to `.env.local`, leaving any existing app-name setting intact:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   ```

   A legacy Supabase `anon` key is also accepted. Service-role keys, secret keys, database passwords and OpenAI keys must never be put in `VITE_*`, the browser bundle or version control. Vite embeds its public configuration at build time; restart/rebuild after changes.
4. Open Profile → Account & cloud sync. Create an account, confirm its email, then sign in. Download a backup, review the local counts, check the explicit linking confirmation, and choose **Upload local records** or **Open cloud records**. Existing cloud overlaps pause for review; nothing is silently overwritten.
5. Test two devices with the same account. Use **Sync now / retry** for an immediate sync; otherwise the app retries every 15 seconds while open, on focus and when connectivity returns. No browser background-sync API is required. Keep the app open until pending changes clear before clearing storage.

For a local Supabase stack with Docker and the Supabase CLI, `supabase start` and `supabase db reset` apply the checked-in configuration/migration; use the URL/public key printed by the CLI. `db reset` is for the disposable local test stack, not an existing hosted project.

### Data integrity and privacy

- Cloud schema version 1 stores one programme, session, workout, recovery observation, test definition/result, match or match metric per row. Profile/goals, settings and scoring rules are small singleton records. Exercise prescriptions, skill results and historical definitions remain embedded in their owning historical records. All Milestone 1–2C persisted data is covered; 2C intentionally has no saved coaching summaries/settings.
- PostgreSQL RLS isolates rows by authenticated owner. The client has SELECT permission only; an authenticated RPC derives the owner from the signed session, serialises account exchanges and checks expected record revisions before atomically writing a batch. No owner ID supplied by a caller is accepted. Tombstones remain indefinitely, so an old device cannot silently recreate deleted rows.
- IndexedDB database/store versions and backup document version 3 remain unchanged. The existing `app` key is untouched on account connection; `account:USER_ID` and `sync:USER_ID` keys store each account's snapshot and durable outbox together in one transaction. Signing out returns to the original local dataset. Another account receives a separate branch. Browser caches are not encrypted; local data remains on the device after sign-out.
- Three-way merges combine independent edits. Overlapping edits/deletions require explicit choices with both versions visible. A relationship conflict never replaces the current working dataset with an invalid graph. Back up before choosing the complete cloud version. Concurrent tab saves are checked against the displayed snapshot and rejected if stale; unsaved forms are not a durable draft store.
- Sync responses contain a consistent full account snapshot, while writes contain only changed records. This prioritises correctness for individual athletes; incremental pagination/change feeds and large team datasets are future work. Exchanges are capped at 100,000 changes and 25 MB. No telemetry or AI transmission is added.
- Backups remain portable v1/v2/v3 JSON exports of the **currently open dataset**, without auth tokens or sync metadata. Restoring while connected replaces that account's local data and queues the resulting cloud additions/changes/deletions. Restoring while signed out changes only the original local dataset. Other account branches are preserved.

### Verification and remaining live checks

`npm test` runs the real migration on embedded PostgreSQL (PGlite), including forced RLS, two distinct authenticated account claims, denied direct writes, atomic rejection, tombstones and malformed requests. Sync tests cover all entity mappings, durable offline edits, two-device merges/conflicts, account switching, in-flight changes, backups and failure recovery. These database tests are not a claim that hosted Supabase Auth has been tested.

`npm run test:e2e` builds a separate `.tools/browser-build` with an explicitly fake Supabase URL/key. Cloud browser tests intercept its requests with deterministic mocks and block service workers so WebKit cannot bypass those mocks; they verify durable offline writes and subsequent online reloads. The existing PWA tests separately verify service-worker-controlled offline reloads. Tests run across desktop Chromium, mobile Chromium and mobile WebKit; the normal `dist` build and your browser's real data are not used. A physical iPhone is still a manual check.

After configuring a real project, create **two dedicated confirmed test accounts**. Set `ATHLETE_TEST_EMAIL_A`, `ATHLETE_TEST_PASSWORD_A`, `ATHLETE_TEST_EMAIL_B`, `ATHLETE_TEST_PASSWORD_B` in your local shell or ignored `.env.local`, alongside the public configuration. Run `npm run test:cloud:live` (Node 22.12+). The script checks actual sign-in, two-account RPC/RLS isolation, denied direct writes, atomic stale batches, deletion propagation and anonymous access. It removes its live test programme, retaining its protocol deletion marker. It never prints credentials. Separately verify email confirmation/recovery links, session refresh/expiry, two physical devices, offline reconnection and HTTPS redirects before declaring Phase 3A live-ready.

Operating costs at this phase are Supabase database/storage, authentication and email delivery; limits depend on the selected plan. No paid AI calls are made. Phase 3B will require separate OpenAI API billing, and Phase 3C will require hosting/deployment configuration. No hosted service or deployment has been created automatically.

## Run locally

Use Node.js 22.12+ or Node 24 (recommended). With NVM, select an installed compatible version, for example `nvm use 24.22.2` on this machine, then:

```sh
npm install
npm run dev
```

Open the printed local address (normally http://localhost:5173). The server binds to all interfaces so an iPhone on the same Wi-Fi can open `http://YOUR_COMPUTER_IP:5173`. Allow the development server through the local firewall if needed. This LAN HTTP address supports UI testing, but **installation and service workers need HTTPS** on the iPhone.

To change the app name, copy `.env.example` to `.env.local`, edit `VITE_APP_NAME`, and restart/rebuild. Business data stays under the stable `athlete-lab` IndexedDB database name so renaming does not discard it.

## Validate

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

The Playwright suite builds an isolated production preview in `.tools/browser-build` and starts it on port 4173 and tests Chromium at iPhone and desktop sizes plus WebKit at an iPhone size, including offline service-worker behaviour. WebKit testing is not a physical iPhone or Safari certification. Startup tests also cover blocked app scripts and disabled JavaScript.

## Test the experience

1. Open Today. Starter sessions are clearly marked **Proposed**; completed workouts and trained minutes start at zero.
2. Open Calendar, change weeks, choose a day and add a session. Enter exercise names, sets, prescriptions, rest and optional coaching notes.
3. In Programme, edit or duplicate sessions, or create and select a separate programme. Session dates can be changed in the editor. You can delete programmes once another exists; this removes their planned sessions and preserves workout history.
4. After training, open a session → **Log this workout**. Tick performed sets, optionally enter actual reps/load, and supply actual duration and effort. Unchecked sets remain unperformed; partial sessions are supported. Enter time/distance results in workout notes.
5. Open Activity to view, correct or delete logs. Refresh and confirm that the data persists.
6. Set your profile, weekly workout target and goals. Use **Save profile & goals** to commit those edits. Try the System, Light and Dark themes.
7. Export a JSON backup from Activity or Profile. It includes programmes, prescriptions, logs, profile, goals, theme and schema version. Restore that export from Profile → Import backup (JSON). See the instructions below.

## Football Skills and Recovery (Milestone 2A)

Open **Skills** or **Recovery** from the desktop sidebar or the shortcuts above the page content on iPhone. The five main mobile tabs are preserved.

### Skills practice

- Create a Skills session in the active programme, or add one for a selected Calendar date. The existing session editor also supports switching a session to Skills.
- Define drills with a skill area, practice objective, success criterion, planned sets and prescription. Supported areas cover one-point and two-point shooting, goal finishing, free-taking, short/long kick-passing, both-foot work, carrying/soloing, first touch/fielding, marking/defending, separation/deception and tactical decisions.
- Optionally specify distance in metres and an angle description; select foot and pressure. Scoring categories are user-selected: the app does not infer scoring rules from distance.
- After practising, log actual attempts with **Success +1**, **Miss +1** and undo, or enter totals directly. Both-foot prescriptions open separate left/right blocks. Add further blocks for a change of conditions. Unused blocks stay unrecorded. Actual duration and effort use the existing workout log fields.
- Skills sessions and completed logs appear in Calendar and Activity. A saved log snapshots the drill, objectives, criteria and conditions, preserving history if the plan is edited or deleted.
- Review history across programmes, filtered by skill, foot, pressure and date period. Left/right counts describe practice exposure. Success rates are weighted by attempts and are only compared within matching drill names, objectives, success criteria and recorded conditions. Unspecified conditions can hide real differences, so these are practice observations rather than standardised performance tests.
- The change metric compares the earlier half of comparable sessions with the more recent half (the recent half receives the extra session for odd totals). It uses percentage points and displays each denominator. At least two sessions are required; multiple blocks in the same session do not create a trend by themselves.

### Recovery observations

- Use **Check in** on Today, **Quick check-in** in Recovery, or a Calendar date. Nothing is required daily and no reminders or automatic injury scores are generated.
- Record training availability, illness noted, missed training and optional recovery observations. Link missed sessions from any programme on the check-in date; links keep their original names even if the plan changes. These observations do not change completion logs or automatically cancel sessions.
- Add muscle/joint/other symptoms with location, side, a self-reported 0–10 severity, optional duration in days and notes. Zero can explicitly record no symptoms at that observation; missing check-ins are never interpreted as zero.
- Edit/delete check-ins, filter by period, location or side, and inspect symptom history for a matching type/location/side. The chart displays up to the latest 12 recorded observations; the table includes all matches. Counts of symptom, illness and missed-training days deduplicate dates, without filling missing days.
- Recovery entries appear in Calendar with a distinct dot. Today only shows the latest check-in from today, so old availability is not presented as current.

### Persistence and limits

The existing IndexedDB database and object store are retained. Milestone 2A introduced document schema version 2 with an empty `recoveryEntries` array for version 1 data; Milestone 2B now upgrades both versions to schema 3 as described below. Existing logs are not converted into skills results. No historical skills or recovery data is seeded. New data is included in JSON exports and remains available offline with the production app.

This is a self-reporting tool: success criteria and angle descriptions are user-defined, and unrecorded conditions limit comparability. The app does not validate technique, adjudicate points, diagnose symptoms, prescribe rehabilitation, forecast readiness or estimate injury risk. A session still has one workout log; duplicate it for another practice occurrence. JSON backup import and optional account synchronisation are available; see Phase 3A above for setup and conflict handling.

## Reliable backup and restoration (Milestone 1.1)

### Export a backup

Save any open forms first. In **Profile → Appearance & your data**, tap **Export all data (JSON)**, or use **Activity → Export data**. Save the downloaded `.json` file somewhere you can find again, such as Files on iPhone. Keep regular copies outside this browser: clearing site data, moving to another browser or changing the address/port does not move your local records. Exports contain personal training and recovery observations, so store and share them accordingly.

### Restore a backup

1. Open Athlete Lab at the address where you want the data restored. Close other Athlete Lab tabs and finish or discard open edits.
2. Go to **Profile → Import backup (JSON)** and choose the original exported file (up to 25 MB). On iPhone, select it from Files.
3. Review the export date, version, athlete, active programme, appearance, target and record counts. Backup and current-device counts appear side by side. Reading the file and displaying this preview do not change any stored records.
4. Use **Export current data** if you want a copy of the records that are about to be replaced.
5. Check **I understand this replaces all data on this device**, then tap **Restore backup**. Cancel or close the dialog to leave your saved data unchanged. Choosing another file resets confirmation.
6. After success, the app opens Today with the restored data and appearance. Reload to verify persistence. You can export again to verify the restored records.

Restoration **replaces the currently open local or account dataset**; it does not merge histories. There is no undo, so keep the previous export if you may need to return to it. Backup files are processed locally. For a connected account, restored changes are queued for cloud synchronisation. Unsaved edits and the app's installed/offline status are not part of a data backup.

### Compatibility and integrity

- Original Milestone 1 exports (document version **1**), Milestone 2A exports (**2**) and current Milestone 2B exports (**3**) are supported. Versions 1 and 2 are upgraded in memory to version 3, preserving all existing records, adding optional performance catalogue definitions and empty test/match histories. Version 1 also gains an empty recovery history. New exports use version 3. The IndexedDB database and object-store version are unchanged.
- Profile, goals, programmes, planned/proposed sessions, completed workouts, historical exercise/drill prescriptions, set results, skills results, recovery symptoms, illness/missed-training observations, test definitions/results/protocols, match records/shot details/metric definitions/scoring rules, and application preferences (theme, target, active programme and performance focus) are included.
- Validation checks the entire document, required fields, types, ranges, calendar dates, save/export timestamps, unique IDs and relationships before any write. Unknown versions/fields, missing sections, invalid results and broken references are rejected with the affected field or record identified. Use the original file or a newer app if the message indicates an unsupported format; do not remove records just to bypass a validation error.
- Historical workout and missed-session snapshots are independent of current plans. Deleted sessions and changes to prescriptions do not invalidate or rewrite history. Exercise IDs need only be unique inside their own prescription. Record dates are preserved even if the importing device clock differs.
- Replacement is a single IndexedDB read/write transaction. The app waits for transaction completion before showing success or changing its displayed data. A quota error or transaction abort retains the previous complete document; the dialog reports failure and permits a confirmed retry. No database clearing or partial imports occur.
- Single-tab editing remains the supported workflow. This feature does not add cross-tab conflict reconciliation, automatic backups, merging, cloud sync, encryption or recovery of a backup file that is itself corrupt/incomplete.

Automated coverage includes complete version 3 round-trips, original version 1/2 exports, malformed/incomplete/incompatible data, duplicate and dangling references, cancelled previews, explicit confirmation, reload/export integrity, quota failures and transaction aborts after a successful write request. Browser tests run on desktop Chromium and iPhone-sized Chromium/WebKit using isolated synthetic records, never your actual browser data.

## Performance Testing and Match Analysis (Milestone 2B)

Open **Performance** from the desktop sidebar or the module shortcuts on iPhone. The original five mobile tabs are retained. Today shows your selected performance measures, while Calendar and Activity show recorded tests and matches alongside existing training. No test results, match statistics or health measurements are seeded.

### Record and compare tests

1. In **Performance → Definitions**, enable the tests you want. The optional catalogue includes 5/10/20/30 m and flying 10 m sprints, countermovement/standing broad jumps, bench press, high-bar squat, trap-bar deadlift, power clean, pull-ups, Yo-Yo IR1/IR2, a running time trial, repeated-sprint mean time and four technical accuracy tests. Create additional definitions for other sports, distances or protocols.
2. Define the unit, direction, calculation, standard protocol, operational definition and details needed for comparison. Best takes the minimum or maximum as selected; Mean averages individual attempts; Manual stores your representative value; Accuracy uses successes / attempts × 100. Time is entered in **seconds**, jumps in **centimetres**, Yo-Yo running distance in **metres**, load in **kg**, pull-ups in whole **reps**, and accuracy in **%**. No unit conversion, stage-to-distance or estimated 1RM calculation occurs.
3. Choose **Record test**. Enter the actual date, result/individual attempts, method, equipment and protocol details. Required details are marked with an asterisk. For strength, specify the repetition criterion and technique; loads at different rep/technique criteria are not interchangeable. Record only attempts actually performed. Links to a programme, training session or profile goal are optional and do not create a workout log.
4. In **Testing**, select a test and optional date/programme filters. Charts, tables, measured personal bests and latest-minus-first changes are grouped by the saved operational definition, protocol, unit, calculation, timing/measurement method, equipment, recorded conditions and quality. Non-accuracy tests also separate differing attempt counts. Electronic and handheld times, Yo-Yo levels, jump methods, run-in distances and exercise techniques are never pooled when recorded differently. Same-day repeats do not create a longitudinal change estimate.
5. Edit or delete results from Testing, Calendar or Activity (deletion is available in Testing). Disabling a test preserves history. Editing a definition changes future entries; existing results retain their own snapshots. Estimated and subjective results remain visible without a measured personal best.

Charts show actual sample sizes and use the observed axis range, with a matching result table. They do not establish a statistically meaningful improvement or interpolate missing measurements. Consistent labels are important: free-text protocols and unrecorded conditions can conceal differences. The app cannot verify the equipment, technique or accuracy of self-entered measurements.

### Record a match quickly

Choose **Record match** in Performance or on a Calendar date. Date and opponent are sufficient. Position, minutes, outcome, team, competition, final score, conditions and tactical notes are optional. Add further detail later by editing the record. Missing numbers remain unknown; explicit zero is retained as zero.

- Identify the observation source (self-report, coach, match video or another described source) and whether statistics were recorded or estimated. Qualitative leadership, decision-making, tactical, positional and overall reflections have no numerical player rating.
- Expand **Scoring** for one-point, two-point and goal attempts/conversions. Conversions cannot exceed known attempts. If only score counts are known, attempts may remain blank. A full points total requires all three score counts; otherwise the app reports known points and clearly marks the full total unknown.
- Alternatively choose **Individual shots**. Record the intended shot type, actual outcome and optional foot, distance, angle, pressure and set/open play. Shot type is user-selected; the app does not adjudicate the two-point rule from distance. A goal attempt over the bar is one goal attempt, zero goal conversions and one awarded point, not an extra one-point attempt. Unknown outcomes are not misses.
- Declare whether the shot log is a complete match record or a partial sample. Partial samples do not produce full-match scoring totals; omitted shot types remain unknown. Switching between shots and aggregate entry explicitly clears the alternate source after confirmation. Backups containing both sources are rejected.
- Attacking, defensive and general contributions are optional expandable sections. Every metric exposes its operational definition and evidence classification. Definitions can be edited/created/disabled in the catalogue and are saved independently with each match. Some counts overlap (for example chances/assists and turnovers/interceptions); the app never sums them into a composite impact rating.
- Global scoring weights are configurable in Definitions (default 1/2/3). New matches copy them; historical matches retain their original rules. Match outcome and final score are entered explicitly, not inferred from the athlete's own scoring.

### Review performance with context

**Matches** provides position/date/programme filters, conversion rates by shot type, scoring trends, passing accuracy, a selected contribution's trend, and position comparisons. Analytics separate recording sources, estimated/recorded statistics and scoring-rule versions. Contribution trends also separate operational-definition versions. Rates use known attempts as their denominator, with actual counts and exclusions shown. Per-70-minute contribution figures use only known positive minutes, and aggregate counts are weighted by their recorded minutes; they are not arbitrary player ratings. Partial shot samples describe recorded shots only.

**Overview** reuses existing skill-practice records and like-for-like drill groups without duplicating them. Choose up to six focus tests and four match measures in Definitions, and optionally show skills/training context. Existing athlete goals remain accessible and can be linked to individual records. Test and match details show the preceding 28 days of logged workout count, minutes, minutes × RPE and recovery observations. These are descriptive context across all programmes, not evidence that training or symptoms caused a performance change. Missing check-ins are unknown. The existing Today dashboard remains the primary weekly consistency view.

The app does not schedule or prescribe maximal testing, provide medical clearance, diagnose symptoms, predict selection, assign elite rankings, invent expected goals, or calculate injury-risk percentages. Recent recovery observations are surfaced in Overview without creating a readiness score. A good test result does not establish that training is medically appropriate.

### Evidence and references

All user-created tests and match metrics default to **Coaching-defined observation**. **Exploratory personal metric** is also available. Research-supported physical-test and match-indicator classifications require a supporting HTTP(S) reference, but the app cannot evaluate the validity of a user-provided citation. Default match/technical metrics and unreferenced protocols are labelled coaching-defined, not automatically validated.

Selected catalogue references were checked during implementation:

- [Anthropometric and Physical Fitness Profile of Adolescent Inter-County Ladies’ Gaelic Football Players](https://www.mdpi.com/2673-7051/3/4/44): context for 5 m/20 m sprint testing; population and protocol limitations apply.
- [Strength and Power Testing of Athletes: A Multicenter Study of Test-Retest Reliability](https://pubmed.ncbi.nlm.nih.gov/35477896/): context for 30 m sprint and countermovement-jump assessment, not proof for every measurement method.
- [Yo-Yo Intermittent Recovery Test Performance in Subelite Gaelic Football Players](https://pubmed.ncbi.nlm.nih.gov/26982971/) and [The yo-yo test: reliability and association with a 20-m shuttle run and VO(2max)](https://pubmed.ncbi.nlm.nih.gov/19114746/): protocol/population context for IR1/IR2, which remain separate tests. No VO2max estimate is derived.
- [GAA Official Guide, April 2026](https://learning.gaa.ie/sites/default/files/2026-04/GAA%20Rule%20Book%20April%202026.pdf): reference for the default scoring weights. Record the actual rules applicable to your competition; no rule adjudication is automated.

These references do not validate individual selection predictions, medical clearance, or the app's coaching-defined match statistics. Bibliographic metadata remains deliberately lightweight.

### Persistence, backups and limits

The IndexedDB database/object store stays at version 1; the single stored document migrates from schema 1/2 to **3** in one write, retaining existing fields. An upgrade write failure leaves the old document in place and displays the existing storage-retry screen. All new entities, snapshots, links and focus preferences are included in the existing validated, previewed, atomic JSON restoration workflow. Original version 1 and 2 exports remain importable and receive empty test/match histories. Offline use remains supported with the production service worker.

This milestone supports manual entry, not live GPS, timing-gate integrations, automatic video analysis or real-time team scorekeeping. Match score entry is the athlete's contribution, not a team event ledger. Comparison groups deliberately favour consistency over merging similar-looking descriptions; no measurement-error threshold or smallest worthwhile change is inferred. Optional cloud sync is described in Phase 3A above. The 25 MB backup limit remains; export separate backups before destructive changes. Use the Definitions catalogue to disable unused measures rather than deleting their history.

## Coaching Context (Milestone 2C)

Open **Coaching Context** from the desktop navigation or iPhone module shortcuts. This feature creates a local context export for you to submit to ChatGPT separately. It does not run an AI model, call an API, upload records, or require a connector, account or paid service.

1. Choose **Quick Context** (14 recent days including today, 7 upcoming days, latest focus tests) or **Detailed Context** (90 recent days, 28 upcoming days, all tests and additional detail).
2. Optionally select/write a coaching question. Expand **Date ranges and sections** to customise inclusive reporting periods and sections. Switching modes resets date ranges while preserving section choices and explicit privacy choices.
3. Review the privacy controls. Athlete name, injury/symptom history, illness, other recovery/availability observations, and free-text notes/reflections all start **off** whenever this page is opened. Health categories are independent; notes within a selected health category also require the free-text-notes option. Titles, goals, protocol descriptions, questions and additional context can contain personal information too, so review the entire preview.
4. Read the **Markdown preview**, then tap **Copy context** and paste it into ChatGPT yourself. If clipboard access is unavailable or denied (common on plain HTTP iPhone LAN addresses), use **Select preview text**, then the selection menu's **Copy**, or Ctrl+C / Cmd+C on desktop.
5. Alternatively download Markdown or structured JSON. The Markdown download matches the preview; JSON contains the same selected facts with structured values. Downloads may open your browser's save/share flow on iPhone. Coaching JSON is **not a full backup** and cannot replace the separate backup/restore workflow.

The generator uses saved application data, including historical workout prescriptions, actual sets/results, practice attempts and denominators, protocol-specific test groups, source-labelled match statistics and saved scoring rules. Proposed/planned sessions remain distinct from completed logs. Unlogged sessions are not automatically called missed; only explicitly included missed-training observations report that. Missing values remain unknown rather than zero. Recovery observations are dated reports, without inferred diagnosis, resolution or clearance. Test comparisons include compatible history through the selected recent end date, even when older than the recent start date; Quick mode prioritises dashboard focus tests when results exist. Exercise names/results describe exposure; no running/cycling distances are invented from prescriptions.

The existing data model does not separately store future match fixtures, confirmed future rest days, commitments, facilities, equipment availability, potential positions, training preferences, programme blocks or rescheduling history. These are labelled unknown rather than inferred. Add relevant information in **Additional athlete context** for this export; it is explicitly user-provided and is not saved to the profile or history. Unscheduled days are not treated as rest days.

Generation, preview, copying and downloads work offline with the installed production app. Pasting/submitting to ChatGPT is a separate action outside Athlete Lab. Context options and summaries are held only while the page is open; there is no export archive, second training history or extra copy of health data in IndexedDB. No database schema or backup format change was needed.

`src/coaching-context.ts` provides deterministic, UI-independent structured generation and Markdown rendering. It accepts a saved snapshot plus explicit options/timestamp, with an optional adapter using the existing repository's `load` interface. `src/CoachingContextPage.tsx` supplies configuration and preview; `src/coaching-export.ts` handles clipboard and local downloads. Automated coverage includes date boundaries, plans versus completions, missing/zero values, calculations, protocol separation, active programme, privacy categories, empty records, Unicode, both formats, clipboard fallback and offline use, alongside existing regression tests.

## Install and test offline

```sh
npm run build
npm run preview
```

Visit http://localhost:4173 on this computer. After the first successful online load, reload once to allow service-worker control, then disable the network and reload. The app shell and IndexedDB data remain available. The development server intentionally does not install the production service worker.

For iPhone installation, host the `dist/` directory at an HTTPS origin (or use a trusted HTTPS development setup), open it in Safari, and use **Share → Add to Home Screen**. Desktop Chromium exposes its install action on supported secure origins. Profile also includes an install button and platform guidance. HTTPS hosting is not provisioned by this local milestone.

## Architecture and data guarantees

- `src/domain.ts`: versioned entities, validation, local calendar-date functions and the clearly labelled proposed Gaelic Football Performance starter programme.
- `src/skills-domain.ts`, `src/skills-ui.tsx`, `src/SkillFields.tsx`: structured drills, explicit attempt logging, weighted metrics and like-for-like comparisons, reusing sessions and workout logs.
- `src/recovery-domain.ts`, `src/recovery-ui.tsx`: optional recovery records, validation, symptom history and calendar/dashboard views.
- `src/performance-domain.ts`, `src/performance-catalogue.ts`, `src/performance-validation.ts`: versioned tests/matches, protocols, scoring, evidence and conservative comparisons.
- `src/performance-ui.tsx`, `src/PerformanceForms.tsx`: focused dashboard, logging, definitions and responsive charts/history.
- `src/validation.ts`: shared complete-document validation primitives.
- `src/backup.ts`, `src/BackupRestore.tsx`: complete backup validation, compatible migration, preview and explicit replacement confirmation.
- `src/repository.ts`: `AthleteRepository` interface and IndexedDB adapter. Extends the existing store with isolated account snapshots and atomic durable change tracking. The UI only commits state after a successful write; failures remain visible.
- `src/App.tsx`: application navigation, Today, weekly calendar, programme selection, history, profile/goals and app installation/update handling.
- `src/components.tsx`: accessible dialog, prescription editor and explicit workout logger.
- `src/styles.css`: responsive design tokens, Tailwind layers, dark mode, safe-area spacing and reduced-motion handling.
- `vite.config.ts`: PWA manifest, precache and offline navigation fallback. Updates are offered explicitly to avoid interrupting a log in progress.

New installations contain **no completed training, performance tests or health measurements**. A weekly target is a configurable planning preference, not a measured result. Logs snapshot the prescription at completion, so later plan edits or session deletion do not rewrite history. A session has at most one workout log; duplicate the session for another occurrence. Weekly completion counts include all programmes, while the calendar displays the active programme.

Unlinked local browser data is not a cloud backup. Data is specific to the browser, device and origin (including port). Clearing site data removes it. Export regularly before clearing data or switching origins. Connected accounts reconcile multi-device changes; stale tab saves are rejected. Use one tab for editing forms. Unsaved form edits are not persisted. Typography uses local system fonts so startup does not depend on an external font service.

If Safari does not open the development app, try the production preview (`npm run build`, then `npm run preview`) at the printed network address on port 4173. This avoids development module loading and hot reload. If startup fails, the page displays a recovery message with local connection details instead of remaining blank; those details contain the origin and browser version, not your training records.

The starting sessions are editable examples, not a personalised coaching prescription. Tailor the plan to your current training and coach’s guidance.

### Dependency maintenance

The lockfile is checked in. The `glob` override selects a patched version for Workbox's build-time file traversal. Remaining npm audit findings are low-severity transitive build-tool advisories through `deepmerge`; its published latest release is still affected. They are not shipped as application runtime dependencies. Review and remove the override when the upstream Workbox dependency range includes the fix.
