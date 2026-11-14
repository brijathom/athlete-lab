# Athlete Lab — Milestones 1 and 2A

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
7. Export a JSON backup from Activity or Profile. It includes programmes, prescriptions, logs, profile, goals, theme and schema version. Export restoration/import is not part of this milestone.

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

The existing IndexedDB database and object store are retained. Document schema version 1 upgrades to version 2 by preserving all existing fields and adding an empty `recoveryEntries` array. Existing logs are not converted into skills results. No historical skills or recovery data is seeded. New data is included in JSON exports and remains available offline with the production app.

This is a self-reporting tool: success criteria and angle descriptions are user-defined, and unrecorded conditions limit comparability. The app does not validate technique, adjudicate points, diagnose symptoms, prescribe rehabilitation, forecast readiness or estimate injury risk. A session still has one workout log; duplicate it for another practice occurrence. Local-only storage, manual export and the existing single-tab editing limitation remain; backup import and cloud sync are not included.

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
