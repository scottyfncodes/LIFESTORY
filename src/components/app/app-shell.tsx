import Link from "next/link";
import { BrandMark } from "./brand-glyph";
import { SignOutButton } from "./sign-out-button";
import { UserCircle2 } from "lucide-react";

export function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur" style={{ paddingTop: "var(--safe-top)" }}>
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link href="/home" className="rounded-md" aria-label="Home">
            <BrandMark />
          </Link>
          <nav className="flex items-center gap-1" aria-label="Account">
            <Link
              href="/account"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-[0.9rem] text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <UserCircle2 className="h-5 w-5" aria-hidden />
              <span className="hidden max-w-[10rem] truncate sm:inline">{userName}</span>
            </Link>
            <SignOutButton className="hidden sm:inline-flex" />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
