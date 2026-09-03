# SlideSync

A real-time presentation sharing app. Upload a PDF or PPTX, get a shareable
link, and present live — the presenter controls which slide is showing and
everyone watching sees it change instantly over WebSocket.

- **Home** — upload a PDF/PPTX, name it, get a shareable viewer link
- **Viewer** (`/view/:id`) — public page that follows the presenter's slide live
- **Presenter** (`/present/:id`) — password-protected control room

## Stack

Node 24, Express 5 + `ws` for the API and real-time sync, PostgreSQL +
Drizzle ORM, React + Vite for the frontend. Everything runs as a single
process: the API server also serves the built frontend, so there's one
deployable service.

## Deploy to Render

This repo includes a [`render.yaml`](./render.yaml) Blueprint and a
[`Dockerfile`](./Dockerfile) (needed for headless PPTX→PDF conversion via
LibreOffice), so deploying is:

1. Push this repo to GitHub (already done if you're reading this here).
2. Go to [render.com](https://render.com) → **New +** → **Blueprint**, and
   connect this GitHub repo.
3. Render reads `render.yaml` and provisions a web service + a Postgres
   database automatically. Click **Apply**.
4. First deploy takes a few minutes (it builds a Docker image with
   LibreOffice in it). Once it's live, open the service URL.

That's it — no manual server setup, no separate object-storage account.
Uploaded files are stored on a small persistent disk attached to the web
service; the database schema is applied automatically before each deploy.

**Costs to be aware of:** the persistent disk (so uploads survive
restarts/redeploys) requires a paid Render web service plan, and Render's
free Postgres databases are time-limited. Check current pricing on
[render.com/pricing](https://render.com/pricing) and adjust the `plan`
fields in `render.yaml` to whatever fits your account — or delete the
`disk:` block if you're fine with uploads being wiped on every restart.

**Presenter password:** Render auto-generates a random value for the
`PRESENTER_PASSWORD` environment variable on first deploy. Find it under
the service's **Environment** tab in the Render dashboard and share it with
whoever will be presenting.

**Optional AI quizzes:** there's a quiz-generation feature that calls an
OpenAI-compatible API. It's entirely optional — the rest of the app works
without it. To enable it, set `AI_INTEGRATIONS_OPENAI_API_KEY` and
`AI_INTEGRATIONS_OPENAI_BASE_URL` in the Render dashboard.

## Local development

Requires Node 24 and pnpm, plus a local (or remote) PostgreSQL database.

```bash
cp .env.example .env   # fill in DATABASE_URL at minimum
pnpm install
pnpm --filter db run push                       # sync the DB schema
pnpm --filter @workspace/api-server run dev      # API on :8080
pnpm --filter @workspace/slide-share run dev     # frontend, separate port
```

Other useful commands:

```bash
pnpm run typecheck   # typecheck everything
pnpm run build       # typecheck + build all packages
```

## Where things live

- `lib/db/src/schema/` — Drizzle schema (presentations, quizzes)
- `artifacts/api-server/src/routes/` — REST routes (presentations, storage, quizzes)
- `artifacts/api-server/src/lib/wsServer.ts` — WebSocket server for live slide sync
- `artifacts/api-server/src/lib/objectStorage.ts` — local-disk file storage
- `artifacts/slide-share/src/` — the React frontend
