# Lock-In Study Planner

**Note:** This repo is mid-rebuild toward a richer app (accounts, classes, streaks, AI reels/plans, backed by Supabase) — see `CLAUDE.md` for the target architecture and migration status. The MVP described below is what's currently live while that migration is in progress.

This is a simple starter web app for the Lock-In idea. It creates a personalized study plan for a student based on:

- subjects or topics
- a goal
- available study time
- preferred focus block length
- due date
- confidence level
- biggest distraction

## Run it

No setup is required.

1. Open `index.html` in a browser.
2. Fill out the form.
3. Generate a study plan.
4. Check off tasks to see the feedback progress update.

## API status

This version is now wired for an AI backend using the OpenAI Responses API.

- the frontend is static and can be hosted on GitHub Pages
- the frontend expects a secure backend endpoint for AI requests
- a Cloudflare Worker example is included in `worker/openai-study-plan-worker.js`
- `gpt-5.4-mini` is the default model in the worker example

Important:

- do not place your OpenAI API key in `config.js`
- `config.js` should only contain a public backend URL
- the secret API key belongs on the backend only
- do not place a private API key directly in this frontend if you host it on GitHub Pages
- GitHub Pages is static hosting, so secrets would be exposed in the browser
- the safest setup here is GitHub Pages for the frontend plus a small backend or serverless function for API calls

## Publish to GitHub Pages

This project is now set up for GitHub Pages with a GitHub Actions workflow in `.github/workflows/deploy-pages.yml`.

1. Create a new GitHub repository.
2. Upload or push this project to that repository.
3. Make sure your default branch is named `main`.
4. On GitHub, open `Settings` > `Pages`.
5. Under `Build and deployment`, choose `GitHub Actions`.
6. Push to `main` and GitHub will publish the site automatically.

Your site URL will usually look like:

`https://your-username.github.io/your-repo-name/`

If your repository is named `LockIn`, the URL will likely be:

`https://your-username.github.io/LockIn/`

## Connect the AI backend

The frontend reads its backend URL from `config.js`.

1. Deploy the worker in the `worker/` folder or build your own backend.
2. Set the backend secret `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL` to a different model.
4. Edit `config.js` and set:

`apiBaseUrl: "https://your-worker-url.workers.dev"`

5. Push the updated frontend to GitHub Pages.

Once connected, the browser will send the student form data to your backend, and the backend will call OpenAI securely.

## Worker example

The example backend in `worker/openai-study-plan-worker.js`:

- accepts `POST /study-plan`
- sends the request to OpenAI's Responses API
- asks the model for JSON only
- returns structured study-plan data to the frontend
- handles basic CORS for a static frontend

There is also a sample `worker/wrangler.toml.example` file for Cloudflare Workers setup.

## What this version includes

- a clean single-page interface
- AI request flow for study-plan generation
- timed study block recommendations
- a daily study plan for the next few days
- personalized focus tips
- instant progress feedback as tasks are completed
- local fallback plan if the AI backend is not connected yet

## Good next steps

- save student plans to local storage or a database
- let students sign in and track streaks
- add authentication for real student accounts
- persist AI-generated plans
- add reminders and accountability features
