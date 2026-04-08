import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import healthDataRouter from "./healthData";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/coach", coachRouter);
router.use("/health", healthDataRouter);

export default router;
