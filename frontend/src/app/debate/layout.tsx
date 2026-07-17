"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { listSessions, getCredits, type SessionSummary, type Credits } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { MadWorldLogo } from "@/components/mad-world-logo";

export default function DebateLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);

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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r p-4">
        <Link href="/debate" className="mb-4 block px-1">
          <MadWorldLogo size="sm" />
        </Link>

        <Button className="mb-4 w-full" onClick={() => router.push("/debate")}>
          + New debate
        </Button>

        <div className="flex-1 space-y-1 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">No past debates yet.</p>
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
          <div className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            ${credits.spent_usd.toFixed(4)} / ${credits.limit_usd.toFixed(2)} used
          </div>
        )}

        <div className="mt-2 flex items-center justify-between border-t pt-4">
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
          <ThemeToggle />
        </div>
      </aside>

      <div className="h-full flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
