import { Router, type Request, type Response } from "express";

const router = Router();

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    providers: {
      apple_health: { connected: false, note: "Apple Health connects directly on-device via HealthKit" },
    },
  });
});

export default router;
