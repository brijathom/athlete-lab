# Athlete Lab — Milestones 1, 1.1, 2A and 2B

A mobile-first, local-first React + TypeScript training PWA. Built with Vite, Tailwind CSS, IndexedDB (`idb`) and a generated Workbox service worker. No backend, account, subscription or AI integration is required.

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

The Playwright suite starts the production preview on port 4173 and tests Chromium at iPhone and desktop sizes plus WebKit at an iPhone size, including offline service-worker behaviour. WebKit testing is not a physical iPhone or Safari certification. Startup tests also cover blocked app scripts and disabled JavaScript.

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

This is a self-reporting tool: success criteria and angle descriptions are user-defined, and unrecorded conditions limit comparability. The app does not validate technique, adjudicate points, diagnose symptoms, prescribe rehabilitation, forecast readiness or estimate injury risk. A session still has one workout log; duplicate it for another practice occurrence. Local-only storage, manual backup and the existing single-tab editing limitation remain. JSON backup import is available; cloud sync is not included.

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

Restoration **replaces all saved data for this browser and origin**; it does not merge histories. There is no undo, so keep the previous export if you may need to return to it. No files are uploaded and there is no backend or cloud storage. Unsaved edits and the app's installed/offline status are not part of a data backup.

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

This milestone supports manual entry, not live GPS, timing-gate integrations, automatic video analysis or real-time team scorekeeping. Match score entry is the athlete's contribution, not a team event ledger. Comparison groups deliberately favour consistency over merging similar-looking descriptions; no measurement-error threshold or smallest worthwhile change is inferred. There is no cloud sync, automatic backup or cross-tab reconciliation. Existing one-tab editing and 25 MB backup limits remain. Use the Definitions catalogue to disable unused measures rather than deleting their history.

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
- `src/repository.ts`: `AthleteRepository` interface and IndexedDB adapter. Replace or extend the adapter for a future API/cloud sync implementation. The UI only commits state after a successful write; failures remain visible.
- `src/App.tsx`: application navigation, Today, weekly calendar, programme selection, history, profile/goals and app installation/update handling.
- `src/components.tsx`: accessible dialog, prescription editor and explicit workout logger.
- `src/styles.css`: responsive design tokens, Tailwind layers, dark mode, safe-area spacing and reduced-motion handling.
- `vite.config.ts`: PWA manifest, precache and offline navigation fallback. Updates are offered explicitly to avoid interrupting a log in progress.

New installations contain **no completed training, performance tests or health measurements**. A weekly target is a configurable planning preference, not a measured result. Logs snapshot the prescription at completion, so later plan edits or session deletion do not rewrite history. A session has at most one workout log; duplicate the session for another occurrence. Weekly completion counts include all programmes, while the calendar displays the active programme.

Local browser data is not an account or a cloud backup. Data is specific to the browser, device and origin (including port). Clearing site data removes it. Export regularly before clearing data or switching origins. Use one tab for editing; cross-device and multi-tab conflict reconciliation are future sync work. Unsaved form edits are not persisted. Typography uses local system fonts so startup does not depend on an external font service.

If Safari does not open the development app, try the production preview (`npm run build`, then `npm run preview`) at the printed network address on port 4173. This avoids development module loading and hot reload. If startup fails, the page displays a recovery message with local connection details instead of remaining blank; those details contain the origin and browser version, not your training records.

The starting sessions are editable examples, not a personalised coaching prescription. Tailor the plan to your current training and coach’s guidance.

### Dependency maintenance

The lockfile is checked in. The `glob` override selects a patched version for Workbox's build-time file traversal. Remaining npm audit findings are low-severity transitive build-tool advisories through `deepmerge`; its published latest release is still affected. They are not shipped as application runtime dependencies. Review and remove the override when the upstream Workbox dependency range includes the fix.
