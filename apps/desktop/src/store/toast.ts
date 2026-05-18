import { create } from "zustand";

export type ToastType = "error" | "success" | "warning" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: ToastItem[];
  add(message: string, type?: ToastType): void;
  remove(id: string): void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  add: (message, type = "error") => {
    const id = Math.random().toString(36).slice(2, 9);
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, type }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Callable outside React components (e.g. axios interceptor)
export const toast = {
  error:   (msg: string) => useToastStore.getState().add(msg, "error"),
  success: (msg: string) => useToastStore.getState().add(msg, "success"),
  warning: (msg: string) => useToastStore.getState().add(msg, "warning"),
  info:    (msg: string) => useToastStore.getState().add(msg, "info"),
};
