import type { Metadata } from "next";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "New memoir" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const user = await requireUser("/projects/new");
  const { intent } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12" style={{ paddingBottom: "calc(3rem + var(--safe-bottom))" }}>
      <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">New memoir</p>
      <h1 className="mt-2 font-serif text-[2.1rem] leading-tight text-ink">Set up the story</h1>
      <p className="mt-2 text-[1rem] leading-relaxed text-ink-2">
        A few choices to get started. Nothing here is final; you can change all of it later in settings.
      </p>
      <OnboardingForm userName={user.name} defaultNarratorIsUser={intent === "host" ? "no" : "yes"} />
    </div>
  );
}
