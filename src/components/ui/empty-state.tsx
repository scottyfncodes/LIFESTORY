import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-dashed border-line-2 bg-paper-2/60 px-6 py-12 text-center">
      {Icon ? (
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-clay shadow-[var(--shadow-soft)]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <h2 className="font-serif text-[1.4rem] text-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-[0.95rem] leading-relaxed text-ink-2">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
