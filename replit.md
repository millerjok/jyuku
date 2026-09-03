# SlideShare

A real-time presentation sharing web app. Users upload PDF or PPTX files, get a shareable link, and can present live — the presenter controls which slide is shown and all viewers see that slide in sync via WebSocket.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/slide-share run dev` — run the frontend (port auto-assigned)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + ws (WebSocket) for real-time sync
- DB: PostgreSQL + Drizzle ORM
- File storage: Replit App Storage (GCS-backed, presigned URL uploads)
- Validation: Zod (v3), generated via Orval from OpenAPI spec
- Frontend: React + Vite + Wouter routing + pdf.js for PDF rendering
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/presentations.ts` — presentations table schema
- `artifacts/api-server/src/routes/presentations.ts` — CRUD + slide update + conversion routes
- `artifacts/api-server/src/lib/wsServer.ts` — WebSocket server (real-time slide sync)
- `artifacts/api-server/src/lib/slideCounter.ts` — PDF page counting (pdf-parse) + PPTX slide counting (adm-zip)
- `artifacts/api-server/src/lib/objectStorage.ts` — GCS object storage client
- `artifacts/slide-share/src/` — frontend React app

## Architecture decisions

- WebSocket server is attached to the same HTTP server as Express (using `noServer` mode with `server.on('upgrade')`) so both REST and WS share port 8080 under `/api`
- Presenter password (`zoe123`) is hardcoded server-side in `presentations.ts` — the `/api/presentations/:id/slide` PATCH endpoint rejects wrong passwords with 401
- File conversion is async: POST /convert responds immediately, updates DB in background. Frontend polls status every 2 seconds
- PPTX files are stored and slide count detected via ZIP parsing. In-browser rendering not supported (LibreOffice unavailable on Replit); users see a download link for PPTX files
- PDF files use pdf-parse for server-side page counting and pdf.js for client-side rendering
- Object storage uses presigned PUT URLs: file bytes go directly from browser to GCS, server never proxies the file data

## Product

- **Home**: Upload PDF/PPTX, name the presentation, get a shareable viewer link
- **Viewer (`/view/:id`)**: Public page that auto-follows the presenter's current slide in real time
- **Presenter (`/present/:id`)**: Password-protected control room. Navigate slides with buttons or arrow keys, broadcast to all viewers instantly

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, run codegen before touching routes: `pnpm --filter @workspace/api-spec run codegen`
- OpenAPI `integer` type causes `zod.int()` which fails in Zod v3 — use `number` type instead
- WS connections are proxied through `/api` prefix (already in api-server artifact.toml paths), no separate `/ws` path needed
- `pdf-parse` import in ESM needs a cast: `(pdfParseModule as any).default ?? pdfParseModule`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `object-storage` skill for GCS storage architecture
