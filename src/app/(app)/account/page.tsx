import type { Metadata } from "next";
import { SignOutButton } from "@/components/app/sign-out-button";
import { requireUser } from "@/server/session";
import { formatDate } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/account");
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12" style={{ paddingBottom: "calc(3rem + var(--safe-bottom))" }}>
      <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Your account</h1>
      <dl className="mt-6 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white/80 text-[0.95rem]">
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3"><dt className="font-medium text-ink">Name</dt><dd className="text-ink-2 sm:col-span-2">{user.name}</dd></div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3"><dt className="font-medium text-ink">Email</dt><dd className="text-ink-2 sm:col-span-2">{user.email}</dd></div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3"><dt className="font-medium text-ink">Member since</dt><dd className="text-ink-2 sm:col-span-2">{formatDate(user.createdAt)}</dd></div>
      </dl>
      <div className="mt-6 flex items-center justify-between rounded-[var(--radius-lg)] border border-line bg-white/80 px-4 py-3">
        <p className="text-[0.95rem] text-ink-2">Sign out of this device.</p>
        <SignOutButton />
      </div>
      <p className="mt-6 text-[0.9rem] leading-relaxed text-ink-3">
        To export or delete a memoir, open its settings. Each project is exported and deleted individually so nothing happens by accident.
      </p>
    </div>
  );
}
