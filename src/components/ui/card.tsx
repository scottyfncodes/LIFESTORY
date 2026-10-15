import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-line bg-white/80 shadow-[var(--shadow-soft)]",
        className,
      )}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("p-5 sm:p-6", className)} {...rest} />;
}
