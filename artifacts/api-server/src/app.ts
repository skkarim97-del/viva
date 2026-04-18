import express, { type Express } from "express";
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

app.use("/api", router);
// Public surfaces deliberately mounted at the root so the invite URL
// the doctor shares is short (`/invite/<token>`) and so universal-link
// verification documents live at the canonical apex paths required by
// iOS and Android.
app.use("/api/invite", inviteJsonRouter);
app.use("/invite", inviteHtmlRouter);
app.use("/.well-known", wellKnownRouter);

export default app;
