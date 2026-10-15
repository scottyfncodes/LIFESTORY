import Link from "next/link";
import { BrandMark } from "@/components/app/brand-glyph";
import { ButtonLink } from "@/components/ui/button";
import { getCurrentUser } from "@/server/session";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/85 backdrop-blur" style={{ paddingTop: "var(--safe-top)" }}>
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="LifeStory home">
            <BrandMark />
          </Link>
          <nav className="flex items-center gap-2" aria-label="Primary">
            {user ? (
              <ButtonLink href="/home" variant="primary" size="sm">
                Open my story
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/sign-in" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/sign-up" variant="primary" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-[0.85rem] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
          <p>LifeStory is made by HaveAnApp.</p>
          <nav className="flex gap-5" aria-label="Footer">
            <Link href="/privacy" className="hover:text-ink">Privacy and your data</Link>
            <Link href="/sign-in" className="hover:text-ink">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
