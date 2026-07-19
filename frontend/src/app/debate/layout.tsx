"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { listSessions, getCredits, type SessionSummary, type Credits } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MadWorldLogo } from "@/components/mad-world-logo";

export default function DebateLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/");
        return;
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    listSessions()
      .then(setSessions)
      .catch(() => {});
    getCredits()
      .then(setCredits)
      .catch(() => {});
  }, [checking, pathname]);

  // Navigating (tapping a debate in the drawer) closes the drawer.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  // One sidebar body, two containers: a static aside on md+ screens and a
  // left drawer on mobile.
  const sidebarContent = (
    <>
      <Link href="/debate" className="mb-4 block px-1">
        <MadWorldLogo size="sm" />
      </Link>

      <Button className="mb-4 w-full" onClick={() => router.push("/debate")}>
        + New discussion
      </Button>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">No past discussions yet.</p>
        )}
        {sessions.map((s) => {
          const href = `/debate/${s.session_id}`;
          const active = pathname === href;
          return (
            <Link
              key={s.session_id}
              href={href}
              title={s.topic}
              className={`block rounded px-2 py-1.5 hover:bg-muted ${
                active ? "bg-muted" : ""
              }`}
            >
              <p
                className={`truncate text-sm ${
                  active ? "font-medium" : "text-muted-foreground"
                }`}
              >
                {s.topic || s.session_id}
              </p>
              <p className="text-xs text-muted-foreground/70">
                {formatRelativeTime(s.created_at)}
              </p>
            </Link>
          );
        })}
      </div>

      {credits && (
        <div className="mt-4 border-t pt-4 font-mono text-xs text-muted-foreground">
          ${credits.spent_usd.toFixed(4)} / ${credits.limit_usd.toFixed(2)} used
        </div>
      )}

      <div className="mt-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 md:hidden">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          className="rounded p-1.5 text-foreground hover:bg-muted"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/debate">
          <MadWorldLogo size="sm" />
        </Link>
        <Button size="sm" className="ml-auto" onClick={() => router.push("/debate")}>
          + New
        </Button>
      </header>

      <aside className="hidden w-64 shrink-0 flex-col border-r p-4 md:flex">{sidebarContent}</aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
