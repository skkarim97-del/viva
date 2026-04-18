import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, HttpError, type Me } from "@/lib/api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((err) => {
        if (err instanceof HttpError && err.status === 401) {
          // expected when not signed in
        } else if (!cancelled) {
          console.warn("[auth] me() failed", err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        me,
        loading,
        async login(email, password) {
          // Drop any stale cache before adopting a new identity so we
          // never paint another user's PHI on a shared workstation.
          queryClient.clear();
          const m = await api.login(email, password);
          setMe(m);
          return m;
        },
        async logout() {
          await api.logout();
          setMe(null);
          // Clear cached patient data after logout for the same reason.
          queryClient.clear();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
