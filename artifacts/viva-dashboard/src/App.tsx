import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { api, HttpError } from "@/lib/api";
import { logEvent as logAnalytics } from "@/lib/analytics";
import { Shell } from "@/components/Shell";
import { LoginPage } from "@/pages/LoginPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { PatientDetailPage } from "@/pages/PatientDetailPage";
import { InternalDashboardPage } from "@/pages/InternalDashboardPage";
import { InternalAnalyticsPage } from "@/pages/InternalAnalyticsPage";
import { MfaEnrollPage } from "@/pages/MfaEnrollPage";
import { MfaVerifyPage } from "@/pages/MfaVerifyPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function NotFound() {
  return (
    <div className="text-muted-foreground py-16 text-center">
      <h1 className="font-display text-[28px] font-bold text-foreground mb-2">
        Not found
      </h1>
      <p className="text-sm font-medium">That page doesn't exist.</p>
    </div>
  );
}

function ProtectedRoutes() {
  // Pilot analytics: every authenticated dashboard mount counts as
  // one `dashboard_opened`. ensureSession() (called inside logEvent)
  // also fires `session_start` once per browser tab.
  useEffect(() => {
    logAnalytics("dashboard_opened");
  }, []);
  return (
    <Shell>
      <Switch>
        <Route path="/" component={PatientsPage} />
        <Route path="/patients/:id">
          {(params) => <PatientDetailPage id={Number(params.id)} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function Gate() {
  const { me, loading } = useAuth();
  const [location, setLocation] = useLocation();

  // /internal is the Viva operator dashboard. It uses its own bearer
  // key, NOT the clinician session, so it must completely bypass the
  // auth gate below -- otherwise an unauthenticated visit would get
  // bounced to /login before the internal page could prompt for the
  // operator key.
  if (location === "/internal") {
    return <InternalDashboardPage />;
  }
  if (location === "/internal/analytics") {
    return <InternalAnalyticsPage />;
  }
  // Viva Analytics now lives in its own top-level artifact at
  // /viva-analytics/ (separate sidebar, separate workflow). The proxy
  // routes that path to a different web service, so there is no route
  // here in viva-dashboard for it.

  // Routes that don't require an authenticated doctor session.
  const isPublic = location === "/login" || location === "/signup";
  const isOnboarding = location === "/onboarding";

  useEffect(() => {
    if (loading) return;
    if (!me) {
      // Send unauthenticated visitors to /login unless they're on a
      // public route (login or signup).
      if (!isPublic) setLocation("/login");
      return;
    }
    if (me.role !== "doctor") {
      // Patient accounts shouldn't reach the dashboard at all.
      return;
    }
    if (isPublic) {
      // A signed-in doctor on /login or /signup gets bounced to the
      // right place: onboarding wizard if incomplete, otherwise home.
      setLocation(me.needsOnboarding ? "/onboarding" : "/");
      return;
    }
    if (me.needsOnboarding && !isOnboarding) {
      // Hard gate: a doctor without a clinic name or with zero patients
      // cannot use the dashboard yet -- the product only works when
      // patients are connected. Push them to the wizard.
      setLocation("/onboarding");
    }
    // Note: we deliberately do NOT auto-redirect AWAY from /onboarding
    // when needsOnboarding flips to false. The wizard refreshes `me`
    // after the first invite is sent so the gate stops bouncing the
    // doctor back, but the doctor stays on the page to copy/resend
    // invite links and clicks "Go to dashboard" themselves when ready.
  }, [me, loading, location, isPublic, isOnboarding, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  // Public auth screens, available whether signed in or not. The effect
  // above handles redirecting away when appropriate.
  if (!me || me.role !== "doctor") {
    return (
      <Switch>
        <Route path="/signup" component={SignUpPage} />
        <Route path="/login" component={LoginPage} />
        <Route component={LoginPage} />
      </Switch>
    );
  }

  // HIPAA pilot: TOTP MFA gate (T007). A doctor with a session must
  // either enroll (no mfaEnrolledAt) or pass step-up verification this
  // session before any PHI route renders. The mfaStatus query is the
  // single source of truth and is invalidated by Mfa{Enroll,Verify}Page
  // on success so the gate naturally falls through.
  //
  // MFA must come BEFORE onboarding because the onboarding wizard's
  // PUT /api/patients/clinic call lives on the patients router, which
  // is gated by requireDoctorMfa server-side. New doctors enroll MFA
  // first, then complete onboarding.
  return <MfaGate me={me} />;
}

function MfaGate({ me }: { me: { needsOnboarding: boolean } }) {
  const { logout } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["mfa-status"],
    queryFn: () => api.mfaStatus(),
    // No automatic refetch -- pages explicitly invalidate after a
    // successful enroll or verify, which is the only state change
    // that should affect this gate's decision.
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (error) {
    // 401 here means the cookie session expired between the AuthContext
    // probe and now -- log out so the gate above bounces to /login.
    if (error instanceof HttpError && error.status === 401) {
      void logout();
      return null;
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground px-6">
        <div>Couldn't check MFA status. Please reload.</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground font-semibold px-5 py-2 rounded-xl"
        >
          Reload
        </button>
      </div>
    );
  }
  if (!data) return null;
  if (!data.enrolled) return <MfaEnrollPage />;
  if (!data.sessionVerified) return <MfaVerifyPage />;
  if (me.needsOnboarding) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route component={OnboardingPage} />
      </Switch>
    );
  }
  return <ProtectedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Gate />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
