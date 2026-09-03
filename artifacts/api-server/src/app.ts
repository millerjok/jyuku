import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// The generated client treats API responses as self-contained JSON payloads.
// A 304 has no body and cannot rehydrate a React Query refetch, so Express
// must not turn API reads into conditional responses.
app.disable('etag');

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production this one Express process also serves the built frontend, so
// a single Render web service is enough — no separate static host, no CORS
// wiring between two origins. The esbuild bundle for this file lands at
// artifacts/api-server/dist/index.mjs, so import.meta.url resolves relative
// to there at runtime.
if (process.env.NODE_ENV === "production") {
  const staticDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../slide-share/dist/public",
  );

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  } else {
    logger.warn({ staticDir }, "Frontend build not found; skipping static file serving");
  }
}

export default app;
