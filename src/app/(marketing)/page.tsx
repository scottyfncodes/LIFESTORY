import Link from "next/link";
import { ArrowRight, BookOpen, Lock, Mic, PenLine, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div>
      <section className="mx-auto w-full max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-24 sm:pb-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-[0.8rem] font-medium uppercase tracking-[0.14em] text-clay">A personal biographer for everyone</p>
          <h1 className="font-serif text-[2.6rem] leading-[1.05] text-ink sm:text-[3.6rem]">
            A life worth remembering.
          </h1>
          <p className="mt-5 max-w-2xl text-[1.1rem] leading-relaxed text-ink-2 sm:text-[1.2rem]">
            LifeStory sits with you and asks about your life, one thoughtful question at a time.
            Speak or type, pause for a day or a month, and come back to find your memories kept
            safely and gently shaped into a book that sounds like you.
          </p>
          <p className="mt-3 font-serif text-[1.15rem] italic text-ink-2">
            Your memories. Your voice. Your story, beautifully told.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/sign-up?intent=self" size="lg">
              Tell my story
              <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/sign-up?intent=host" variant="secondary" size="lg">
              Help someone tell theirs
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="border-y border-line/70 bg-paper-2/60">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:py-16">
          <div>
            <h2 className="font-serif text-[1.7rem] text-ink">A conversation, not a questionnaire</h2>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink-2">
              The interviewer remembers what you have already said and follows the thread of your
              life rather than a checklist. You can skip anything, correct anything, and say
              &ldquo;I&rsquo;d rather not talk about that.&rdquo;
            </p>
            <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
              <p className="text-[0.75rem] font-medium uppercase tracking-[0.12em] text-ink-3">Interview</p>
              <p className="mt-3 font-serif text-[1.25rem] leading-snug text-ink">
                You mentioned the house on Elm Street had a porch where your grandmother sat in the
                evenings. What do you remember about those evenings?
              </p>
              <div className="mt-5 flex items-center gap-3 text-[0.85rem] text-ink-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1"><Mic className="h-3.5 w-3.5" aria-hidden /> Speak</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1"><PenLine className="h-3.5 w-3.5" aria-hidden /> Type</span>
                <span>Skip for now</span>
              </div>
            </div>
          </div>
          <div>
            <h2 className="font-serif text-[1.7rem] text-ink">A real book, written from your words</h2>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink-2">
              Chapters grow from what you actually said. Every passage can be traced back to your own
              answers, nothing is invented to fill a gap, and you can edit any line before you export
              a printable PDF or an editable Word document.
            </p>
            <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-[0.75rem] font-medium uppercase tracking-[0.12em] text-ink-3">Chapter two</p>
              <h3 className="mt-2 font-serif text-[1.5rem] text-ink">The Porch on Elm Street</h3>
              <p className="prose-book mt-3 text-[1.05rem]">
                Each passage in your book is drafted from your saved answers and shows you which
                conversation it came from, so the story on the page stays yours.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          <Feature icon={BookOpen} title="For yourself" text="Interview yourself in an ongoing conversation that picks up where you left off." />
          <Feature icon={Users} title="With family" text="Sit beside a parent or grandparent and run the interview together on one device." />
          <Feature icon={Lock} title="Private by design" text="Projects are private to you. You can export everything or delete it at any time." />
        </div>
        <div className="mt-10 rounded-[var(--radius-lg)] border border-line bg-white p-6 sm:p-8">
          <h2 className="font-serif text-[1.5rem] text-ink">Your story belongs to you</h2>
          <p className="mt-2 max-w-3xl text-[0.975rem] leading-relaxed text-ink-2">
            Recordings and transcripts are stored privately and only processed to transcribe your
            words and draft your book. We don&rsquo;t sell, advertise against, or train models on your
            memoir. AI-written passages can contain mistakes, which is why every one links back to
            what you said and waits for your review.
          </p>
          <Link href="/privacy" className="mt-4 inline-flex items-center gap-1.5 text-[0.95rem] font-medium text-clay hover:text-clay-2">
            Read how your data is handled <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof BookOpen; title: string; text: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-white/70 p-5">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-clay-soft text-clay">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-4 font-serif text-[1.25rem] text-ink">{title}</h3>
      <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}
