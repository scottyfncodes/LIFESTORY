export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12" aria-busy="true" aria-live="polite">
      <div className="h-4 w-32 animate-pulse-soft rounded bg-paper-3" />
      <div className="mt-3 h-9 w-72 max-w-full animate-pulse-soft rounded bg-paper-3" />
      <div className="mt-8 h-32 animate-pulse-soft rounded-[var(--radius-lg)] bg-paper-2" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="h-28 animate-pulse-soft rounded-[var(--radius-lg)] bg-paper-2" />
        <div className="h-28 animate-pulse-soft rounded-[var(--radius-lg)] bg-paper-2" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
