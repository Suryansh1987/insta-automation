import axios from "axios";
import { toast } from "../store/toast";

export const SERVER_URL = ((import.meta.env.VITE_BACKEND_URL as string) ?? "http://localhost:3001").replace(/\/$/, "");

// Set by <AuthSetup> after Clerk loads — lets the interceptor get tokens outside React hooks
let _getToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

const api = axios.create({ baseURL: SERVER_URL, timeout: 15_000 });

api.interceptors.request.use(async (config) => {
  if (_getToken) {
    const token = await _getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Global error interceptor — surfaces unexpected errors as toasts.
// Skips errors that callers mark with { skipGlobalToast: true } so they can
// show their own inline feedback without doubling up.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const config = err.config as any;
    if (config?.skipGlobalToast) return Promise.reject(err);

    const status: number | undefined = err.response?.status;
    const msg: string = err.response?.data?.error ?? err.message ?? "Something went wrong.";

    if (!err.response) {
      // Network / timeout
      toast.error("Cannot reach the server. Check your connection.");
    } else if (status === 401) {
      toast.error("Session expired. Please sign in again.");
    } else if (status === 429) {
      toast.warning(msg);
    } else if (status && status >= 500) {
      toast.error(`Server error (${status}): ${msg}`);
    }
    // 400 / 403 / 404 — let the calling component handle inline (form errors, etc.)

    return Promise.reject(err);
  },
);

export default api;
