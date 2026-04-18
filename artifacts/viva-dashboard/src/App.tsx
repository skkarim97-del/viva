import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Shell } from "@/components/Shell";
import { LoginPage } from "@/pages/LoginPage";
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
          {(params) => (
            <PatientDetailPage id={Number(params.id)} />
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function Gate() {
  const { me, loading } = useAuth();
  const [location, setLocation] = useLocation();

  // Bounce unauthenticated visitors to /login, and keep doctors out of the
  // login screen once they have a session.
  useEffect(() => {
    if (loading) return;
    if (!me && location !== "/login") {
      setLocation("/login");
    } else if (me && me.role === "doctor" && location === "/login") {
      setLocation("/");
    }
  }, [me, loading, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!me || me.role !== "doctor") {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route component={LoginPage} />
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
