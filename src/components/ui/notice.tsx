import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "warning" | "danger";

const tones: Record<Tone, { box: string; icon: LucideIcon; iconClass: string }> = {
  info: { box: "bg-paper-2 border-line text-ink-2", icon: Info, iconClass: "text-ink-3" },
  success: { box: "bg-moss-soft border-moss/30 text-ink-2", icon: CheckCircle2, iconClass: "text-moss" },
  warning: { box: "bg-ochre-soft border-ochre/30 text-ink-2", icon: AlertTriangle, iconClass: "text-ochre" },
  danger: { box: "bg-rose-soft border-rose/30 text-ink-2", icon: AlertTriangle, iconClass: "text-rose" },
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div
      className={cn("flex gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-[0.925rem] leading-relaxed", t.box, className)}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", t.iconClass)} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
