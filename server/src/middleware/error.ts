import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { BillingError } from "../services/billing";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation error",
      details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
  }

  if (err instanceof BillingError) {
    console.error(`[billing-error] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof Error) {
    console.error(`[error] ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  res.status(500).json({ error: "Internal server error" });
}
