import { Notice } from "./notice";

export function FormMessage({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (success) return <Notice tone="success">{success}</Notice>;
  return null;
}
