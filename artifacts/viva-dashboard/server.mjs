import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT);
if (!PORT || Number.isNaN(PORT)) {
  throw new Error("PORT environment variable is required.");
}

const API_ORIGIN = process.env.API_ORIGIN;
if (!API_ORIGIN) {
  throw new Error(
    "API_ORIGIN environment variable is required (e.g. https://viva-ai.replit.app).",
  );
}

const STATIC_DIR = path.resolve(__dirname, "dist", "public");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Root-path convenience redirect. Matches only the literal "/" path so
// it cannot shadow /api/* (proxied to upstream), /healthz, the static
// asset middleware, or the SPA fallback. 302 keeps the redirect
// non-permanent so the landing target can change without cached
// redirects sticking in clients.
app.get("/", (_req, res) => {
  res.redirect(302, "/viva-dashboard");
});

app.use(
  createProxyMiddleware({
    target: API_ORIGIN,
    // changeOrigin: true is required when the upstream is an HTTPS host
    // behind a TLS/SNI router (Replit edge): the proxy must send the
    // upstream Host (and SNI) so it routes to the correct deployment
    // and presents the correct certificate.
    changeOrigin: true,
    xfwd: true,
    pathFilter: "/api/**",
    proxyTimeout: 30_000,
    timeout: 30_000,
    logger: console,
    on: {
      error: (err, _req, res) => {
        console.error("[proxy] upstream error:", err?.message || err);
        if (!res || res.headersSent) return;
        try {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_unavailable",
              message: "The Viva API is temporarily unreachable.",
            }),
          );
        } catch {
          // best-effort; underlying socket may already be closed
        }
      },
    },
  }),
);

app.use(
  express.static(STATIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }),
);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `viva-dashboard server listening on :${PORT} (proxy -> ${API_ORIGIN})`,
  );
});
