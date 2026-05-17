import { create } from "zustand";
import type { Plan } from "@insta-saas/shared";

interface PlanState {
  plan: Plan | null;
  setPlan: (plan: Plan) => void;
  clear: () => void;
}

export const usePlanStore = create<PlanState>()((set) => ({
  plan: null,
  setPlan: (plan) => set({ plan }),
  clear: () => set({ plan: null }),
}));
