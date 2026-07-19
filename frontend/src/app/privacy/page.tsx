import Link from "next/link";

export const metadata = { title: "Privacy — Mad World" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-4 text-3xl">Privacy</h1>

      <div className="space-y-4 text-sm text-muted-foreground">
        <p>
          This is a small, personal project — not a company, not a funded product. Here&apos;s
          what actually happens with your data, plainly:
        </p>
        <p>
          <strong className="text-foreground">Sign-in.</strong> You sign in with Google. We
          receive your name and email from Google via Supabase Auth to identify your account. We
          don&apos;t see or store your Google password.
        </p>
        <p>
          <strong className="text-foreground">Discussions.</strong> The topics, agent
          configurations, and transcripts of discussions you run are stored so you can revisit
          them later from the sidebar. They&apos;re tied to your account and not visible to
          anyone else — unless you explicitly create a public share link, which anyone holding
          the link can read until you unshare it.
        </p>
        <p>
          <strong className="text-foreground">Usage.</strong> We track how much each discussion
          costs in API spend, attributed to your account, to enforce a fair-use credit limit.
        </p>
        <p>
          <strong className="text-foreground">Nobody else gets this.</strong> Nothing here is
          sold, shared, or used for anything beyond running the app and keeping usage within
          reasonable limits.
        </p>
        <p>
          Want your data deleted, or have a question? Email{" "}
          <a className="underline" href="mailto:mpj1391996@gmail.com">
            mpj1391996@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
