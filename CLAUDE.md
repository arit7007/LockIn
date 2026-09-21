# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lock-In is a study app for students: accounts, an onboarding quiz, multiple classes with difficulty/deadlines, AI-generated study plans, a swipeable quiz/flashcard "Reels" feature, and a Progress dashboard with streaks and charts.

**Migration in progress.** The repo is mid-rebuild from a stateless single-form MVP (no accounts, one plan per visit, Cloudflare Worker + OpenAI backend) toward the richer app described above (Supabase accounts + Postgres + Edge Function AI backend). See `LockInDesign/` for the source mockups this is being extracted from, and the active plan for phase-by-phase status. Until the migration completes, `index.html`/`script.js`/`styles.css`/`config.js` may still reflect the old MVP shape.

## Commands

There is no build step, package manager, or test suite in this repo (no `package.json`) for the frontend.

- Run the app: open `index.html` directly in a browser, or serve the directory with any static file server.
- Deploy the frontend: push to `main` — `.github/workflows/deploy-pages.yml` publishes the repo root to GitHub Pages automatically. Static hosting only — Supabase is the backend, there is no server to deploy alongside it.
- Supabase backend (`supabase/`): standard `supabase` CLI workflow — `supabase link`, `supabase db push` to apply `supabase/migrations/`, `supabase functions deploy ai`, `supabase secrets set ANTHROPIC_API_KEY=...`. Requires a Supabase account; there is no local backend to run without one.
- **Legacy, being retired**: `worker/openai-study-plan-worker.js` is the old Cloudflare Worker backend for the pre-migration MVP. Deploy via `wrangler` with `wrangler.toml` (copy from `worker/wrangler.toml.example`) and `wrangler secret put OPENAI_API_KEY`. Do not extend this — new AI logic belongs in `supabase/functions/ai/`.

## Architecture

**Target architecture (`supabase/`)**
- Supabase project: email/password auth, Postgres, Edge Functions. Frontend stays static (GitHub Pages) — Supabase is backend-as-a-service, not a server to host.
- `supabase/migrations/0001_init.sql` — three tables, each with RLS scoped to `auth.uid()`:
  - `profiles` (1:1 with `auth.users`, auto-created via the `handle_new_user` trigger on signup): name, level, `prefs` jsonb (study-habit onboarding answers), `streak`/`last_active`/`daily` (activity tracking), `plans_made`/`reels_answered`/`reels_correct` counters, `onboarded` flag.
  - `classes`: a student's courses (`name`, `difficulty`, `next_test`), one row per class, not a JSON blob.
  - `study_plans`: generated plans (`input`, `plan`, `source: 'ai'|'fallback'`) so they survive a refresh.
- `supabase/functions/ai/` — Edge Function the frontend calls via `supabase.functions.invoke('ai', ...)` (never raw `fetch` with the anon key — that skips per-user JWT verification). Holds the `ANTHROPIC_API_KEY` secret server-side, same "secrets never in frontend config" rule as the legacy worker below.
- `config.js` carries `SUPABASE_URL`/`SUPABASE_ANON_KEY` — safe to be public (RLS is the real security boundary, not key secrecy), same posture as the legacy `apiBaseUrl`.

**Legacy frontend (root: `index.html`, `script.js`, `styles.css`, `config.js`) — pre-migration MVP, being replaced**
- `config.js` defines `window.LOCKIN_CONFIG` — only public values (`apiBaseUrl`, `studyPlanPath`, `useLocalFallback`). Never put secret keys here; this ships to the browser via GitHub Pages.
- `script.js` is a single vanilla-JS module (no bundler, no framework) that:
  - reads student form data (`getStudentData`)
  - POSTs to `${apiBaseUrl}${studyPlanPath}` for an AI-generated plan (`requestAIStudyPlan` / `normalizeAIPlan`)
  - falls back to `buildFallbackStudyPlan` (a rule-based planner using `getPhase`/`evaluateReadiness`/`getFocusTip`) when `apiBaseUrl` is unset, the request fails, or `useLocalFallback` is true
  - both the AI path and the fallback path converge on the same plan shape (`days`, `readiness`, `minutesPerStudyDay`, `sessionsPerStudyDay`, `focusTip`, `coachNote`, `planSummary`) before `renderPlan` draws it — when changing the plan schema, update both producers and the renderer together
  - all user-facing text is passed through `escapeHtml`/`sanitizeText` before insertion into the DOM

**Legacy backend (`worker/openai-study-plan-worker.js`) — being retired in favor of `supabase/functions/ai/`**
- A Cloudflare Worker exposing `POST /study-plan`, proxying to OpenAI's Responses API (`gpt-5.4-mini` by default, overridable via `OPENAI_MODEL`).
- Keeps `OPENAI_API_KEY` server-side; this is the only piece that should ever hold that secret.
- `normalizeStudentData`/`normalizePlan` mirror the same clamping/shape logic as the frontend's fallback builder — the worker and `script.js` intentionally duplicate validation/normalization since there's no shared module between them (static frontend vs. separate Worker deploy). Keep the plan JSON shape (see `buildSystemPrompt`) in sync with what `normalizeAIPlan` in `script.js` expects.
- CORS is wide open (`Access-Control-Allow-Origin: *`) since the frontend is static and has no origin to restrict to.

**`LockInDesign/`**
- Design/export assets, several with mismatched extensions from how they were exported — check actual content with `file`/binary inspection before assuming the extension is correct. Only two files are actually markup: `logo.png` (dark theme) and `pasted-1788146169485-0.png` (light theme) are both full HTML app mockups, functionally identical to each other, and are the source this rebuild is being extracted from (light theme as the base — dependency-free; dark theme is wrapped in a proprietary component shell that needs stripping). Everything else in the folder is a genuine binary image (logos, a reference screenshot), not markup.

## Security notes specific to this repo

- Two config surfaces exist and must not be conflated: `config.js` (public, frontend, GitHub Pages) vs. backend secrets (private — Supabase Edge Function secrets via `supabase secrets set`, or the legacy Worker's `wrangler secret put`). The README's "API status" section explains why — GitHub Pages is static hosting, so anything in `config.js` is public.
- `SUPABASE_ANON_KEY` is meant to be public (RLS enforces access, not key secrecy) — but the Supabase project hardcoded in the `LockInDesign/` mockups (`zbbnjebnzwhhflhgpsqu`) is a leftover from the design-tool export with unverified RLS. Do not reuse it for the real app; the migration stands up a fresh project.
