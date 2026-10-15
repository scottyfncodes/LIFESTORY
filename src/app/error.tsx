"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the digest is logged client-side; no content.
    console.error("page_error", error.digest ?? "no-digest");
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">Something went wrong</p>
      <h1 className="mt-2 font-serif text-[1.8rem] text-ink">We hit a problem loading this page</h1>
      <p className="mt-2 max-w-md text-ink-2">Your saved work is safe. Try again, and if it keeps happening, come back a little later.</p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
