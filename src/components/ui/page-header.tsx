import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">{eyebrow}</p> : null}
        <h1 className="font-serif text-[2rem] leading-[1.1] text-ink sm:text-[2.4rem]">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-[1rem] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
