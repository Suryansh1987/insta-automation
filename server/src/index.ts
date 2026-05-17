import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { accountsRouter } from "./routes/accounts";
import { plansRouter, razorpayWebhookHandler } from "./routes/plans";
import { automationRouter } from "./routes/automation";
import { errorHandler } from "./middleware/error";

if (!process.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY is required");
}

const app = express();

app.use(helmet());
app.use(cors());
app.post("/plans/webhook", express.raw({ type: "application/json" }), razorpayWebhookHandler);
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/accounts", accountsRouter);
app.use("/plans", plansRouter);
app.use("/automation", automationRouter);

app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`[server] API running on http://localhost:${PORT}`);
});

export default app;
