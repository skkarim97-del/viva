import { Router, type Request, type Response } from "express";

// Universal-link / app-link verification documents. These MUST be
// served from the apex of the production domain over HTTPS with a
// valid TLS chain, exactly like /robots.txt -- no redirects, no auth,
// no cookies, no charset suffix on the JSON Content-Type.
//
// On iOS, the OS fetches /.well-known/apple-app-site-association the
// first time the app launches after install (and periodically after).
// If the response 200's with valid JSON whose `appIDs` includes the
// correct <TeamID>.<Bundle>, the OS starts intercepting matching
// HTTPS URLs and routing them to the app.
//
// On Android, /.well-known/assetlinks.json plays the same role for
// `android:autoVerify="true"` intent filters.
//
// We require APPLE_TEAM_ID to be set as an env var. Without it we
// return 404 rather than a placeholder file -- a wrong team ID is
// cached aggressively by Apple and is much harder to recover from
// than a temporary 404.

const router: Router = Router();

router.get("/apple-app-site-association", (_req: Request, res: Response) => {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    res.status(404).type("text/plain").send("APPLE_TEAM_ID not configured");
    return;
  }
  const bundleId = "com.sullyk97.vivaai";
  // Both modern (`webcredentials` + `applinks` array of `details`) and
  // legacy schemas; iOS picks whichever it understands.
  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          appIDs: [`${teamId}.${bundleId}`],
          paths: ["/invite/*"],
          components: [{ "/": "/invite/*", comment: "Patient invite links" }],
        },
      ],
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`],
    },
  };
  // CRITICAL: bare application/json, no charset. Apple's verifier is
  // picky about this header and will silently ignore the file if the
  // Content-Type has any extra parameters.
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  // Use end(), not send(string). Express's res.send() helpfully appends
  // "; charset=utf-8" to the Content-Type when given a string, and
  // Apple's swcd verifier silently ignores the AASA when the type has
  // any extra parameters.
  res.status(200).end(JSON.stringify(aasa));
});

router.get("/assetlinks.json", (_req: Request, res: Response) => {
  const sha256 = process.env.ANDROID_APP_SIGNING_SHA256?.trim();
  if (!sha256) {
    res.status(404).type("text/plain").send("ANDROID_APP_SIGNING_SHA256 not configured");
    return;
  }
  const packageName = "com.sullyk97.vivaai";
  const assetlinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [sha256],
      },
    },
  ];
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  // See AASA handler above for why we end() rather than send() here.
  res.status(200).end(JSON.stringify(assetlinks));
});

export default router;
