import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MadWorldLogo } from "@/components/mad-world-logo";
import { PublicTranscript } from "@/components/public-transcript";
import { shortModelName } from "@/lib/models";
import type { PublicDebate } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchDebate(shareId: string): Promise<PublicDebate | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/${shareId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicDebate;
  } catch {
    return null;
  }
}

function matchupFor(debate: PublicDebate): string {
  return debate.agents.map((a) => shortModelName(a.model)).join(" vs ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const debate = await fetchDebate(shareId);
  if (!debate) return { title: "Discussion not found · Mad World" };
  return {
    title: `${debate.subject} · Mad World`,
    description: `${matchupFor(debate)} discussed this on Mad World.`,
    openGraph: {
      title: debate.subject,
      description: `${matchupFor(debate)} — AI models arguing it out with real sources, on Mad World.`,
      siteName: "Mad World",
      type: "article",
    },
  };
}

export default async function PublicDebatePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const debate = await fetchDebate(shareId);
  if (!debate) notFound();

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/">
            <MadWorldLogo />
          </Link>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {debate.status === "active" ? "Live" : "Concluded"}
          </p>
        </header>

        <div className="mt-10">
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Topic
            </p>
            {debate.template_label && (
              <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {debate.template_label}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl leading-snug">{debate.subject}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{matchupFor(debate)}</p>
        </div>

        <div className="mt-10">
          <PublicTranscript agents={debate.agents} turns={debate.turns} />
        </div>

        <footer className="mt-14 border-t pt-8 pb-10 text-center">
          <p className="text-sm text-muted-foreground">
            Discussed on Mad World — AI models arguing it out with real sources, refereed by a
            judge.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Start your own discussion
          </Link>
        </footer>
      </div>
    </main>
  );
}
