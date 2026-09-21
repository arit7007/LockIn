# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lock-In is a static study-plan generator for students. A plain HTML/CSS/JS frontend collects student inputs (subjects, goal, weekly hours, focus-block length, due date, confidence, biggest distraction) and either calls an AI backend for a generated plan or falls back to a deterministic local plan builder.

## Commands

There is no build step, package manager, or test suite in this repo (no `package.json`).

- Run the app: open `index.html` directly in a browser, or serve the directory with any static file server.
- Deploy: push to `main` — `.github/workflows/deploy-pages.yml` publishes the repo root to GitHub Pages automatically.
- Deploy the backend worker: from `worker/`, use `wrangler` with `wrangler.toml` (copy from `worker/wrangler.toml.example`) and set the `OPENAI_API_KEY` secret via `wrangler secret put OPENAI_API_KEY`.

## Architecture

**Frontend (root: `index.html`, `script.js`, `styles.css`, `config.js`)**
- `config.js` defines `window.LOCKIN_CONFIG` — only public values (`apiBaseUrl`, `studyPlanPath`, `useLocalFallback`). Never put secret keys here; this ships to the browser via GitHub Pages.
- `script.js` is a single vanilla-JS module (no bundler, no framework) that:
  - reads student form data (`getStudentData`)
  - POSTs to `${apiBaseUrl}${studyPlanPath}` for an AI-generated plan (`requestAIStudyPlan` / `normalizeAIPlan`)
  - falls back to `buildFallbackStudyPlan` (a rule-based planner using `getPhase`/`evaluateReadiness`/`getFocusTip`) when `apiBaseUrl` is unset, the request fails, or `useLocalFallback` is true
  - both the AI path and the fallback path converge on the same plan shape (`days`, `readiness`, `minutesPerStudyDay`, `sessionsPerStudyDay`, `focusTip`, `coachNote`, `planSummary`) before `renderPlan` draws it — when changing the plan schema, update both producers and the renderer together
  - all user-facing text is passed through `escapeHtml`/`sanitizeText` before insertion into the DOM

**Backend (`worker/openai-study-plan-worker.js`)**
- A Cloudflare Worker exposing `POST /study-plan`, proxying to OpenAI's Responses API (`gpt-5.4-mini` by default, overridable via `OPENAI_MODEL`).
- Keeps `OPENAI_API_KEY` server-side; this is the only piece that should ever hold that secret.
- `normalizeStudentData`/`normalizePlan` mirror the same clamping/shape logic as the frontend's fallback builder — the worker and `script.js` intentionally duplicate validation/normalization since there's no shared module between them (static frontend vs. separate Worker deploy). Keep the plan JSON shape (see `buildSystemPrompt`) in sync with what `normalizeAIPlan` in `script.js` expects.
- CORS is wide open (`Access-Control-Allow-Origin: *`) since the frontend is static and has no origin to restrict to.

**`LockInDesign/`**
- Design/export assets. Several files have mismatched extensions from how they were exported (e.g. a file named `.png` may actually be HTML, `.js` may actually be a PNG) — check actual content with `file`/binary inspection before assuming the extension is correct.

## Security notes specific to this repo

- Two config surfaces exist and must not be conflated: `config.js` (public, frontend, GitHub Pages) vs. Worker environment secrets (private, backend, `wrangler secret put`). The README's "API status" section explains why — GitHub Pages is static hosting, so anything in `config.js` is public.
