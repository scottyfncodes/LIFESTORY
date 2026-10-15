import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "clay" | "moss" | "ochre" | "rose";

const tones: Record<Tone, string> = {
  neutral: "bg-paper-2 text-ink-2 border-line",
  clay: "bg-clay-soft text-clay-2 border-clay/20",
  moss: "bg-moss-soft text-moss border-moss/20",
  ochre: "bg-ochre-soft text-ochre border-ochre/25",
  rose: "bg-rose-soft text-rose border-rose/20",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.75rem] font-medium leading-5", tones[tone], className)}>
      {children}
    </span>
  );
}
