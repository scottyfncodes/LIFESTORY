import { AppShell } from "@/components/app/app-shell";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell userName={user.name}>{children}</AppShell>;
}
