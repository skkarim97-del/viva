import type { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  auth: { userId: number; role: "doctor" | "patient" };
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.session.userId;
  const role = req.session.role;
  if (!userId || !role) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as AuthedRequest).auth = { userId, role };
  next();
}

export function requireDoctor(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  requireAuth(req, res, () => {
    const auth = (req as AuthedRequest).auth;
    if (auth.role !== "doctor") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
}

export function requirePatient(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  requireAuth(req, res, () => {
    const auth = (req as AuthedRequest).auth;
    if (auth.role !== "patient") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
}
