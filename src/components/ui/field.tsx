import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const control =
  "w-full rounded-[var(--radius-md)] border border-line bg-white px-3.5 text-[1rem] text-ink placeholder:text-ink-3 shadow-[inset_0_1px_1px_rgba(34,29,24,0.03)] focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20 disabled:bg-paper-2";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-[7rem] py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 appearance-none pr-9 bg-no-repeat bg-[right_0.9rem_center] bg-[length:12px_12px]", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' stroke='%237a7067' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cn("block text-[0.9rem] font-medium text-ink", className)} {...rest} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  optional,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string[] | string | null;
  children: ReactNode;
  optional?: boolean;
}) {
  const errors = Array.isArray(error) ? error : error ? [error] : [];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-xs text-ink-3">Optional</span> : null}
      </div>
      {children}
      {hint ? <p className="text-[0.85rem] leading-relaxed text-ink-3" id={`${htmlFor}-hint`}>{hint}</p> : null}
      {errors.length > 0 ? (
        <p className="text-[0.85rem] text-rose" id={`${htmlFor}-error`} role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
