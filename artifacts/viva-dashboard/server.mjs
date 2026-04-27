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

// Backward-compat redirect: the dashboard used to live at
// /viva-dashboard. Any old link (bookmark, email, deep link) that
// still points there is rewritten to the equivalent location at the
// new root. We use 301 (permanent) so search engines and browsers
// remember the new canonical URL. The regex matches:
//   /viva-dashboard          -> /
//   /viva-dashboard/         -> /
//   /viva-dashboard/login    -> /login
//   /viva-dashboard/foo/bar  -> /foo/bar
// preserving query string via req.originalUrl semantics (Express
// keeps the querystring on req.url for unmounted middleware).
//
// SECURITY: we strip every leading slash from `tail` before
// re-prefixing with our own single "/", because a request path like
// "/viva-dashboard//evil.com" would otherwise produce a
// scheme-relative Location header ("//evil.com") and turn this route
// into an open redirect that could be weaponized for phishing under
// our canonical domain.
app.get(/^\/viva-dashboard(?:\/(.*))?$/, (req, res) => {
  const rawTail = req.params[0] ?? "";
  const safeTail = rawTail.replace(/^\/+/, "");
  const qIdx = req.originalUrl.indexOf("?");
  const qs = qIdx >= 0 ? req.originalUrl.slice(qIdx) : "";
  res.redirect(301, `/${safeTail}${qs}`);
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
