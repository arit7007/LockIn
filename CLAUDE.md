# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lock-In is a study app for students: accounts, a trimmed onboarding quiz (with an optional expandable section for extra preferences, plus an AI photo/screenshot schedule scanner as an alternative to typing classes by hand), multiple classes with difficulty/deadlines, AI-generated study plans, a swipeable quiz/flashcard "Reels" feature, and a Progress dashboard with streaks and charts.

## Commands

There is no build step, package manager, or test suite in this repo (no `package.json`) for the frontend.

- Run the app: open `index.html` directly in a browser, or serve the directory with any static file server.
- Deploy the frontend: push to `main` — `.github/workflows/deploy-pages.yml` publishes the repo root to GitHub Pages automatically. Static hosting only — Supabase is the backend, there is no server to deploy alongside it. GitHub Pages must be manually enabled once per repo (Settings → Pages → Source: GitHub Actions) and the repo must be public on a free GitHub plan — the workflow file alone doesn't turn Pages on.
- Supabase backend (`supabase/`): apply schema/Edge Function changes via the Supabase dashboard (SQL Editor for `supabase/migrations/*.sql`, Edge Functions tab for `supabase/functions/ai/index.ts`) or the `supabase` CLI (`supabase link`, `supabase db push`, `supabase functions deploy ai`, `supabase secrets set ANTHROPIC_API_KEY=...`). Requires a Supabase account; there is no local backend to run without one.
- Auth redirect URLs (Site URL + Redirect URLs under Authentication → URL Configuration in the dashboard) must point at the real deployed URL, not the `localhost:3000` default new Supabase projects ship with — email confirmation links redirect through that setting.
- **Legacy, being retired**: `worker/openai-study-plan-worker.js` is the old Cloudflare Worker backend for the pre-migration stateless MVP. Not used by the current app — superseded by `supabase/functions/ai/`. Slated for deletion once the Edge Function has run stable for a while.

## Architecture

**Frontend (root: `index.html`, `script.js`, `styles.css`, `config.js`)**
- `config.js` defines `window.LOCKIN_CONFIG` — only public values (`supabaseUrl`, `supabaseAnonKey`). Never put secret keys here; this ships to the browser via GitHub Pages. The anon/publishable key is safe to expose — RLS is the actual access boundary, not key secrecy.
- `script.js` is a single vanilla-JS module (no bundler, no framework, no build step) covering: Supabase email/password auth, a 3-step onboarding wizard, classes CRUD, and four app tabs (Home, Plan, Reels, Progress).
- **Onboarding** (`startOnboarding`/`gotoStep`): Step 1 (name/level), Step 2 (classes — manual add, or `scanScheduleBtn`/`scheduleFile` to upload a schedule photo/screenshot for AI extraction into the class list; difficulty always stays a manual per-class pick, never inferred), Step 3 asks only focus-time and study-methods up front plus an optional goal field — the rest (attention span, distraction, motivation, session length) live inside a collapsed `#morePrefs` section (`setMorePrefsOpen`) that auto-expands on "Retake setup" if those fields already have answers. Kept intentionally short per onboarding-UX research (cap forced-choice questions at 2-3; defer/optional the rest) rather than asking all 7 fields up front.
- `onAuthStateChange` deliberately ignores `TOKEN_REFRESHED`/`INITIAL_SESSION` events (just updates the `user` reference) and only triggers a full profile reload/re-render on real sign-in/sign-out — Supabase fires background token-refresh events on tab refocus, and treating those the same as sign-in was resetting the onboarding wizard back to step 1 on every alt-tab.
- `askAI(prompt, image?)` calls the `ai` Edge Function via `supabase.functions.invoke()` (never raw `fetch` with the anon key as bearer — that skips per-user JWT verification). Optional `image: {data, mediaType}` (base64, no data-URL prefix) is used only by the schedule-scan feature; text-only calls (plan/reels/coach feedback) omit it.
- **Study Plan generation** (`genPlan` handler) tries the AI path first; on any failure it falls back to `buildFallbackPlan` — a deterministic, no-AI planner (sorts classes by difficulty/deadline, sizes blocks from the chosen hours/day, rotates through foundation → practice → review phases) — so the feature still works if the Edge Function is down. Both paths converge on the same plan shape (`{summary, days:[{day,focus,blocks:[{time,subject,task,technique}]}], tips}`) before `renderPlan` draws it, and both get persisted via `saveStudyPlan` to the `study_plans` table with `source: 'ai'|'fallback'`. Reels and Coach feedback have no offline fallback (no sensible deterministic equivalent) — they just surface a friendly error on AI failure.
- All user-facing text is passed through `esc`/`sanitizeText`-style escaping before insertion into the DOM.

**Backend (`supabase/`)**
- Supabase project: email/password auth, Postgres, Edge Functions. Frontend stays static (GitHub Pages) — Supabase is backend-as-a-service, not a server to host.
- `supabase/migrations/0001_init.sql` — idempotent (`if not exists`/`drop ... if exists` throughout, safe to rerun) — three tables, each with RLS scoped to `auth.uid()`:
  - `profiles` (1:1 with `auth.users`, auto-created via the `handle_new_user` trigger on signup): name, level, `prefs` jsonb (study-habit onboarding answers — `distraction`/`motivation`/`methods` are arrays, multi-select), `streak`/`last_active`/`daily` (activity tracking), `plans_made`/`reels_answered`/`reels_correct` counters, `onboarded` flag.
  - `classes`: a student's courses (`name`, `difficulty`, `next_test`), one row per class, not a JSON blob.
  - `study_plans`: generated plans (`input`, `plan`, `source: 'ai'|'fallback'`) so they survive a refresh.
- `supabase/functions/ai/index.ts` — the Edge Function `askAI()` calls. Verifies the caller's JWT via `supabase.auth.getUser()`, then proxies to Anthropic (`claude-haiku-4-5-20251001`) using the `ANTHROPIC_API_KEY` secret (`supabase secrets set`, never in frontend config). Accepts `{prompt, image?}`, returns `{text}` on success or `{error}` on failure — the client always does its own JSON-extraction/parsing (`extractJSON`) on the returned text, so the function itself stays a thin, uniform "call the model" endpoint regardless of whether the caller wants a study plan, reels, coach feedback, or (new) a schedule-photo class extraction.

**`LockInDesign/`**
- Design/export assets this app was extracted from, several with mismatched extensions from how they were exported — check actual content with `file`/binary inspection before assuming the extension is correct. Only two files are actually markup: `logo.png` (dark theme) and `pasted-1788146169485-0.png` (light theme) — functionally identical mockups; the light one was the extraction source (dependency-free; the dark one is wrapped in a proprietary component shell). Everything else in the folder is a genuine binary image (logos, a reference screenshot), not markup.

## Security notes specific to this repo

- Two config surfaces exist and must not be conflated: `config.js` (public, frontend, GitHub Pages) vs. backend secrets (private — Supabase Edge Function secrets via `supabase secrets set`, or the legacy Worker's `wrangler secret put`).
- `supabaseAnonKey` is meant to be public (RLS enforces access, not key secrecy) — but the Supabase project this app actually runs on turned out to be the same one hardcoded in the `LockInDesign/` mockups (`zbbnjebnzwhhflhgpsqu` — discovered when the user's existing account/data surfaced during migration). Its old-format legacy anon key is already public in this repo's git history from before the rebuild; the newer `sb_publishable_...` key now wired into `config.js` is a distinct credential. RLS (added in `0001_init.sql`) is what actually protects the data either way.
