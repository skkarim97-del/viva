import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { sessionApi, type AuthedUser } from "@/lib/api/sessionClient";

interface AuthState {
  loading: boolean; // initial bootstrap from AsyncStorage
  user: AuthedUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  activate: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Drives the patient gate. On cold start we read the stored bearer token,
// validate it against /auth/me, and either route the user into the app
// or into the connect screen. Without this layer the mobile app would
// keep doing local-only storage and the dashboard would never see the
// patient's check-ins.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await sessionApi.getStoredToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await sessionApi.me();
        if (!cancelled) setUser(me);
      } catch {
        // Network down or transient -- keep stored token, treat as
        // signed-out for this launch so the gate doesn't deadlock.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const u = await sessionApi.login(email, password);
    setUser(u);
  }, []);

  const activate = useCallback(async (token: string, password: string) => {
    const u = await sessionApi.activate(token, password);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await sessionApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ loading, user, signIn, activate, signOut }),
    [loading, user, signIn, activate, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
