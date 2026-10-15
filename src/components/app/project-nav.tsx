"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Clock, MessageCircle, Settings, Users, Home } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const items = [
  { segment: "", label: "Overview", icon: Home },
  { segment: "interview", label: "Interview", icon: MessageCircle },
  { segment: "timeline", label: "Timeline", icon: Clock },
  { segment: "people", label: "People", icon: Users },
  { segment: "book", label: "My Book", icon: BookOpen },
  { segment: "settings", label: "Settings", icon: Settings },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <>
      <nav className="hidden sm:block" aria-label="Project sections">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {items.map((item) => {
            const href = item.segment ? `${base}/${item.segment}` : base;
            const active = item.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <li key={item.segment}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 border-b-2 px-3 text-[0.925rem] transition-colors",
                    active ? "border-clay text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
        aria-label="Project sections"
      >
        <ul className="grid grid-cols-6">
          {items.map((item) => {
            const href = item.segment ? `${base}/${item.segment}` : base;
            const active = item.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <li key={item.segment}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 text-[0.65rem] font-medium",
                    active ? "text-clay" : "text-ink-3",
                  )}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.label === "My Book" ? "Book" : item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
