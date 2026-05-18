export type Plan = "free" | "pro" | "max";

export interface PlanLimit {
  maxAccounts: number;
  dailyMessages: number;
  label: string;
  price: string;
}

export const PLAN_LIMITS: Record<Plan, PlanLimit> = {
  free: { maxAccounts: 1, dailyMessages: 10, label: "Free", price: "₹0/mo" },
  pro: { maxAccounts: 3, dailyMessages: 200, label: "Pro", price: "₹3,000/mo" },
  max: { maxAccounts: 5, dailyMessages: 1000, label: "Max", price: "₹6,000/mo" },
};

export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    "1 Instagram account",
    "10 messages per day",
    "Basic DM automation",
    "Default message templates",
  ],
  pro: [
    "3 Instagram accounts",
    "200 messages per day",
    "AI-personalized messages",
    "Excel target upload",
    "Priority support",
  ],
  max: [
    "5 Instagram accounts",
    "1000 messages per day",
    "AI-personalized messages",
    "Excel target upload",
    "Proxy support per account",
    "Analytics dashboard",
    "Priority support",
  ],
};
