import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="bg-background">
        <div className="max-w-6xl mx-auto px-6 pt-8 pb-5 flex items-center justify-between">
          <Link href="/" aria-label="viva clinic home" className="block">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {me && (
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <span className="font-semibold text-foreground">
                  {me.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  Care team
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                await logout();
                setLocation("/login");
              }}
              className="px-4 py-2 rounded-2xl bg-card text-foreground font-semibold hover:bg-secondary active:scale-[0.97] transition-all"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-border" />
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {children}
      </main>
      <footer className="text-center text-xs text-muted-foreground pb-8">
        viva clinic
      </footer>
    </div>
  );
}
