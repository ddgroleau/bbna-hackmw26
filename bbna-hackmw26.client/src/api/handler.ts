import type { Request, Response } from "express";
import { Router } from "express";
import analyzeRoute from "./routes/analyze.js";

const router = Router();

router.use("/analyze", analyzeRoute);

router.use((_: Request, res: Response) => {
  res.status(404).json({ success: false, error: "Endpoint not found" });
});

export default router;
