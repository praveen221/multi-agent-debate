"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace("/debate");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <h1 className="text-3xl font-semibold">Multi-Agent Debate</h1>
      <p className="max-w-md text-muted-foreground">
        Pick a topic, pick your models, and watch AI agents debate it turn by
        turn — with real independent web search.
      </p>
      <Button onClick={signIn} size="lg">
        Sign in with Google
      </Button>
      <Link
        href="/privacy"
        className="absolute bottom-6 text-xs text-muted-foreground hover:underline"
      >
        Privacy
      </Link>
    </main>
  );
}
