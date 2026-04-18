import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import healthDataRouter from "./healthData";
import authRouter from "./auth";
import patientsRouter from "./patients";
import meRouter from "./me";
import internalRouter from "./internal";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/coach", coachRouter);
router.use("/health", healthDataRouter);
router.use("/auth", authRouter);
router.use("/patients", patientsRouter);
router.use("/me", meRouter);
// Operator-only metrics. Gated by its own bearer key (INTERNAL_API_KEY)
// rather than the doctor session, so signed-in clinicians cannot pull
// product analytics through their browser session.
router.use("/internal", internalRouter);

export default router;
