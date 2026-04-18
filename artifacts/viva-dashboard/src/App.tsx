import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Shell } from "@/components/Shell";
import { LoginPage } from "@/pages/LoginPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { PatientDetailPage } from "@/pages/PatientDetailPage";

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
