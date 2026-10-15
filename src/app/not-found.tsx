import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">Not found</p>
      <h1 className="mt-2 font-serif text-[2rem] text-ink">We couldn&rsquo;t find that page</h1>
      <p className="mt-2 max-w-md text-ink-2">It may have been removed, or you may not have access to it.</p>
      <ButtonLink href="/home" className="mt-6">Go to your stories</ButtonLink>
    </div>
  );
}
