import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api, HttpError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ClinicLockup } from "@/components/ClinicLockup";

type State = "verifying" | "expired" | "used" | "error";

export function MagicLinkCallbackPage() {
  const [, setLocation] = useLocation();
  const { setMe } = useAuth();
  const [state, setState] = useState<State>("verifying");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setState("error");
      return;
    }
    api
      .verifyMagicLink(token)
      .then((me) => {
        setMe(me);
        setLocation(me.needsOnboarding ? "/onboarding" : "/");
      })
      .catch((err) => {
        if (err instanceof HttpError) {
          if (err.status === 410) {
            setState("expired");
          } else if (err.status === 409) {
            setState("used");
          } else {
            setState("error");
          }
        } else {
          setState("error");
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Signing you in...
      </div>
    );
  }

  const messages: Record<Exclude<State, "verifying">, { title: string; body: string }> = {
    expired: {
      title: "This link has expired",
      body: "Sign-in links expire after 15 minutes. Request a new one below.",
    },
    used: {
      title: "This link has already been used",
      body: "Sign-in links are single-use. Request a new one below.",
    },
    error: {
      title: "Something went wrong",
      body: "We couldn't verify your sign-in link. Please try again.",
    },
  };

  const { title, body } = messages[state];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>
        <div className="bg-card rounded-[20px] p-7 space-y-4 text-center">
          <p className="text-lg font-bold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          <button
            type="button"
            onClick={() => setLocation("/login")}
            className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
