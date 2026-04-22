import express, { type Express, type ErrorRequestHandler, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middlewares/session";
import { inviteHtmlRouter, inviteJsonRouter } from "./routes/invite";
import wellKnownRouter from "./routes/wellknown";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        // Activation tokens travel in the URL path for /invite/<token>
        // and /api/invite/<token>. They are bearer-grade secrets until
        // burned, so we mask them before they hit the log pipeline.
        const rawUrl = req.url?.split("?")[0] ?? "";
        const url = rawUrl.replace(
          /^(\/api)?\/invite\/[^/?#]+/,
          (_m, api) => `${api ?? ""}/invite/[redacted]`,
        );
        return {
          id: req.id,
          method: req.method,
          url,
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
// CORS with credentials so the doctor dashboard (served at a different
// path) can attach the session cookie. Origin is reflected back per
// request, which is fine because the cookie is sameSite=lax.
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Root-level liveness probe. Mounted before the /api router so external
// uptime monitors and load balancers can hit a stable, prefix-free URL
// without authentication or any DB dependency. The detailed structured
// equivalent stays at /api/healthz for in-app clients.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

// Root-path convenience redirect. Only matches the literal "/" path so
// it cannot shadow /api/*, /invite/*, /.well-known/*, /health, or any
// other prefix-mounted route below. 302 (temporary) keeps the door open
// to changing the landing target later without cached redirects sticking.
app.get("/", (_req, res) => {
  res.redirect(302, "/viva-dashboard");
});

app.use("/api", router);
// Public surfaces deliberately mounted at the root so the invite URL
// the doctor shares is short (`/invite/<token>`) and so universal-link
// verification documents live at the canonical apex paths required by
// iOS and Android.
app.use("/api/invite", inviteJsonRouter);
app.use("/invite", inviteHtmlRouter);
app.use("/.well-known", wellKnownRouter);

// 404 fallback for unknown API paths. Returns JSON instead of Express's
// default HTML so mobile clients (which always JSON.parse the body)
// surface a clean error to the user instead of a parse exception.
const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "not_found", path: req.originalUrl });
};
app.use(notFoundHandler);

// Last-resort error handler. Without a 4-arg middleware, throws inside
// route handlers either crash the process or hang the response. This
// guarantees every error gets logged through the same pino pipeline as
// regular requests (with secret redaction) and the client always sees
// JSON. Production responses never leak internal messages or stacks.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Status from common error shapes; default to 500. Anything <500 is
  // a client error and not worth a `level=error` log line.
  const rawStatus =
    typeof (err as { status?: number })?.status === "number"
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: number })?.statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, "request handler error");
  } else {
    logger.warn({ err, path: req.originalUrl, method: req.method, status }, "request rejected");
  }

  if (res.headersSent) {
    // Express will close the connection; nothing safe left to do here.
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  const message =
    status >= 500 && isProd
      ? "internal_server_error"
      : (err as { message?: string })?.message ?? "internal_server_error";
  res.status(status).json({ error: message });
};
app.use(errorHandler);

export default app;
