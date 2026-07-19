"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  deleteSession,
  getCredits,
  listSessions,
  renameSession,
  type Credits,
  type SessionSummary,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { MadWorldLogo } from "@/components/mad-world-logo";

export default function DebateLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    listSessions()
      .then((rows) => {
        setSessions(rows);
        // A just-created session's auto-title lands a moment after creation —
        // one delayed refetch picks it up without polling.
        const titlePending = rows.some(
          (r) => !r.title && Date.now() - new Date(r.created_at).getTime() < 5 * 60_000,
        );
        if (titlePending) {
          retry = setTimeout(() => listSessions().then(setSessions).catch(() => {}), 6000);
        }
      })
      .catch(() => {});
    getCredits()
      .then(setCredits)
      .catch(() => {});
    return () => clearTimeout(retry);
  }, [checking, pathname]);

  // Navigating (tapping a debate in the drawer) closes the drawer.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (editingId) editInputRef.current?.select();
  }, [editingId]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  function labelFor(s: SessionSummary): string {
    return s.title || s.topic || s.session_id;
  }

  function startRename(s: SessionSummary) {
    setMenuFor(null);
    setEditValue(labelFor(s));
    setEditingId(s.session_id);
  }

  function commitRename(sessionId: string) {
    const title = editValue.trim();
    setEditingId(null);
    const current = sessions.find((s) => s.session_id === sessionId);
    if (!current || !title || title === labelFor(current)) return;
    setSessions((prev) =>
      prev.map((s) => (s.session_id === sessionId ? { ...s, title } : s)),
    );
    renameSession(sessionId, title).catch(() =>
      listSessions().then(setSessions).catch(() => {}),
    );
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await deleteSession(target.session_id);
      setSessions((prev) => prev.filter((s) => s.session_id !== target.session_id));
      if (pathname === `/debate/${target.session_id}`) router.replace("/debate");
    } catch {
      listSessions().then(setSessions).catch(() => {});
    }
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

          if (editingId === s.session_id) {
            return (
              <div key={s.session_id} className="rounded bg-muted px-2 py-1.5">
                <input
                  ref={editInputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(s.session_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.session_id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  maxLength={120}
                  autoFocus
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
            );
          }

          return (
            <div
              key={s.session_id}
              className={`group relative rounded hover:bg-muted ${active ? "bg-muted" : ""}`}
            >
              <Link href={href} title={s.topic} className="block px-2 py-1.5 pr-8">
                <p
                  className={`truncate text-sm ${
                    active ? "font-medium" : "text-muted-foreground"
                  }`}
                >
                  {labelFor(s)}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {formatRelativeTime(s.created_at)}
                </p>
              </Link>
              <Popover
                open={menuFor === s.session_id}
                onOpenChange={(open) => setMenuFor(open ? s.session_id : null)}
              >
                <PopoverTrigger
                  render={
                    <button
                      aria-label="Discussion options"
                      className={`absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground ${
                        menuFor === s.session_id
                          ? ""
                          : "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      }`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                />
                {/* hover:bg-muted is invisible here — popover and muted share
                    the same surface color, so use a white overlay instead. */}
                <PopoverContent align="start" side="right" className="w-28 p-1">
                  <button
                    onClick={() => startRename(s)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-white/10"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      setMenuFor(null);
                      setDeleteTarget(s);
                    }}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-white/10"
                  >
                    Delete
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
      </div>

      {credits && (
        <div className="mt-4 border-t pt-4 font-mono text-xs text-muted-foreground">
          ${credits.spent_usd.toFixed(4)} / ${credits.limit_usd.toFixed(2)} used
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t pt-4">
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
        <FeedbackDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Feedback
            </Button>
          }
        />
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this discussion?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget ? labelFor(deleteTarget) : ""}” will be removed from your
              account, and any public share link will stop working. This can&apos;t be
              undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
