import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/app/auth-form";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; intent?: string }> }) {
  const { next, intent } = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/home");
  return <AuthForm mode="sign-up" next={next} intent={intent} />;
}
