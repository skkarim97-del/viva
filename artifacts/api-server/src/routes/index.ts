import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import healthDataRouter from "./healthData";
import authRouter from "./auth";
import patientsRouter from "./patients";
import meRouter from "./me";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/coach", coachRouter);
router.use("/health", healthDataRouter);
router.use("/auth", authRouter);
router.use("/patients", patientsRouter);
router.use("/me", meRouter);

export default router;
