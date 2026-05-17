import axios from "axios";
import "dotenv/config"
export const SERVER_URL = import.meta.env.VITE_BACKEND_URL;

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

export default api;
