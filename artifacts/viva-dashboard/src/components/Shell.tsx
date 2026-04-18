import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-xl font-bold tracking-tight hover:text-accent transition-colors"
          >
            VIVA <span className="text-accent">·</span> Clinic
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/70 hidden sm:inline">
              {me?.name} <span className="text-white/40">· {me?.email}</span>
            </span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                setLocation("/login");
              }}
              className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {children}
      </main>
      <footer className="text-center text-xs text-ink-mute pb-6">
        VIVA Doctor Dashboard · Phase 1 MVP
      </footer>
    </div>
  );
}
