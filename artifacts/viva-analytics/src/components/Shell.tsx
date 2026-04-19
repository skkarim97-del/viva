import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

/**
 * App shell. Sidebar lives on the left, top header on the right.
 *
 * Why a sidebar (not a top tab bar like viva-clinic):
 * - signals "different product mode" the moment the page loads
 * - scales to 6+ sections without becoming a horizontal scroll trap
 * - matches what every analytics tool the team uses already does
 *   (Mixpanel, Amplitude, PostHog, Linear Insights), so the muscle
 *   memory transfers
 *
 * The sidebar is always visible on md+; on mobile it collapses into
 * a slide-over drawer.
 */

interface NavItem {
  href: string;
  label: string;
  hint?: string;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/", label: "Overview", hint: "What's happening right now" },
  { href: "/operating", label: "Operating", hint: "DAU · WAU · MAU · adoption" },
  { href: "/retention", label: "Retention", hint: "Treatment status & stop reasons" },
  { href: "/behavior", label: "System behavior", hint: "Interventions & signals" },
  { href: "/patients", label: "Patients", hint: "Per-patient drill-down" },
  { href: "/doctors", label: "Doctors", hint: "Per-doctor drill-down" },
];

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`block px-3 py-2.5 rounded-xl transition-colors ${
        active
          ? "bg-[var(--color-sidebar-active)]/15 text-white"
          : "text-[var(--color-sidebar-foreground)] hover:bg-white/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block w-1 h-4 rounded-full ${active ? "bg-[var(--color-sidebar-active)]" : "bg-transparent"}`}
        />
        <span className="font-display font-semibold text-[13px]">
          {item.label}
        </span>
      </div>
      {item.hint && (
        <div className="text-[11px] mt-0.5 ml-3 opacity-70 leading-snug">
          {item.hint}
        </div>
      )}
    </Link>
  );
}

export function Shell({
  children,
  generatedAt,
  onSignOut,
}: {
  children: ReactNode;
  generatedAt: string | null;
  onSignOut: () => void;
}) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes so a click on
  // a nav row doesn't leave the overlay sitting on top of the page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const sidebar = (
    <aside className="bg-[var(--color-sidebar)] text-[var(--color-sidebar-foreground)] flex flex-col h-full">
      <div className="px-5 pt-6 pb-5">
        {/* Brand lockup: viva. wordmark + product label, no separators
            or badges. Matches the pattern used by viva-clinic and
            viva-care so the three surfaces read as one platform. */}
        <div className="flex items-center gap-2 mb-1">
          <Logo size="sm" variant="white" />
          <span className="font-display text-[16px] font-medium text-white/80 tracking-tight">
            Analytics
          </span>
        </div>
        <div className="text-[11px] opacity-60 mt-1.5 leading-snug">
          Internal operating dashboard
        </div>
      </div>
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {NAV.map((n) => (
          <NavRow key={n.href} item={n} active={isActive(n.href)} />
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-white/10 text-[11px] opacity-60 space-y-1">
        <div>
          {generatedAt
            ? `Refreshed ${new Date(generatedAt).toLocaleTimeString()}`
            : "Awaiting first refresh"}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="text-[var(--color-sidebar-active)] hover:underline"
        >
          Sign out of analytics
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar — fixed width, always visible from md+. */}
      <div className="hidden md:flex md:w-[240px] shrink-0 sticky top-0 h-screen">
        {sidebar}
      </div>

      {/* Mobile drawer overlay. */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 left-0 w-[260px] z-50 md:hidden">
            {sidebar}
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — slim. The sidebar already carries product
            identity, so this row is mostly utility. */}
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
          <div className="px-5 md:px-8 py-3 flex items-center gap-3">
            <button
              type="button"
              className="md:hidden p-2 -ml-2 rounded-lg hover:bg-secondary"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <SectionTitle />
            <div className="flex-1" />
            <a
              href="/viva-dashboard/"
              target="_top"
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              ↗ Viva Clinic
            </a>
          </div>
        </header>
        <main className="flex-1 px-5 md:px-8 py-6 max-w-[1400px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}

function SectionTitle() {
  const [location] = useLocation();
  const match = NAV.find((n) =>
    n.href === "/" ? location === "/" : location.startsWith(n.href),
  );
  return (
    <div className="font-display text-[14px] font-bold text-foreground">
      {match?.label ?? "Viva Analytics"}
    </div>
  );
}
