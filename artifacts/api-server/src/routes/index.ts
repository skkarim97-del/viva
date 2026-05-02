import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import healthDataRouter from "./healthData";
import authRouter from "./auth";
import patientsRouter from "./patients";
import meRouter from "./me";
import mfaRouter from "./mfa";
import internalRouter from "./internal";
import interventionsRouter from "./interventions";
import outcomesRouter from "./outcomes";
import careEventsRouter from "./careEvents";
import analyticsRouter from "./analytics";
import patientInterventionsRouter from "./patientInterventions";
import clinicInterventionsRouter from "./clinicInterventions";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/coach", coachRouter);
router.use("/health", healthDataRouter);
router.use("/auth", authRouter);
router.use("/patients", patientsRouter);
// /me/mfa MUST be mounted BEFORE /me because the /me router globally
// applies requirePatient -- without an earlier mount, doctors could
// not enroll or verify TOTP at all (T007).
router.use("/me/mfa", mfaRouter);
router.use("/me", meRouter);
router.use("/interventions", interventionsRouter);
router.use("/outcomes", outcomesRouter);
router.use("/care-events", careEventsRouter);
router.use("/analytics", analyticsRouter);
// AI-personalized micro-intervention loop (HIPAA pilot). Patient
// router covers the lifecycle (generate/active/accept/dismiss/
// feedback/escalate); clinic router exposes the doctor-facing
// worklist + per-patient history. Mounted under /patient/* and
// /clinic/* to match spec Part 6's URL contract; /clinic does NOT
// share a prefix with /care-events because the worklist needs a
// single dedicated entry point.
router.use("/patient/interventions", patientInterventionsRouter);
router.use("/clinic/interventions", clinicInterventionsRouter);
// Operator-only metrics. Gated by its own bearer key (INTERNAL_API_KEY)
// rather than the doctor session, so signed-in clinicians cannot pull
// product analytics through their browser session.
router.use("/internal", internalRouter);

export default router;
