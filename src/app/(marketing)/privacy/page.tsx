import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy and your data" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">Privacy and your data</p>
      <h1 className="mt-2 font-serif text-[2.2rem] leading-tight text-ink">How LifeStory handles your story</h1>
      <div className="mt-6 space-y-8 text-[1rem] leading-relaxed text-ink-2">
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">What is stored</h2>
          <p className="mt-2">Your answers (typed or transcribed), any audio recordings you choose to keep, the people, places and events we note from your answers, and every draft and edit of your book. Each is stored in a private project that only you and people you explicitly add can open.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Which services process your content</h2>
          <p className="mt-2">Interview questions, memory notes and chapter drafts are produced by a configured AI provider; audio is transcribed by a configured transcription provider. The exact providers in use are listed in each project&rsquo;s settings. When voice services are not configured, recording uses your browser&rsquo;s own speech recognition, which may send audio to your browser vendor; the app tells you before that happens.</p>
          <p className="mt-2">LifeStory does not use your memoir to train models, does not show advertising, and does not make private projects discoverable or indexable.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Usage counts</h2>
          <p className="mt-2">LifeStory counts page views with Pulse, an analytics service run by HaveAnApp, so we can see which pages get used. When a page loads, your browser sends Pulse the page address and the address of the page you came from. Like any website, Pulse&rsquo;s server, hosted by Vercel, also sees your IP address and browser details.</p>
          <p className="mt-2">From that, Pulse keeps the page path (ids such as project and chapter ids are replaced with a placeholder, and anything after a &ldquo;?&rdquo; is dropped), the domain of the site that linked you if it was another site, any campaign tags in the link, the time, your country, your device type, browser and operating system, and a visitor code. The visitor code is made by scrambling your IP address and browser details with a random value that is replaced every day, so it changes daily and is not linked to your account. Pulse does not store your IP address or full browser details, sets no cookies, and never receives your answers, recordings or book. These records are kept in a database hosted by Neon, and Pulse is set to delete them after 400 days.</p>
          <p className="mt-2">Pulse does not count browsers that send Do Not Track or Global Privacy Control. To turn counting off on one device, open any LifeStory page with <code className="text-[0.9em]">?pulse=ignore</code> added to the address; your browser then keeps that one setting.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Recordings</h2>
          <p className="mt-2">Audio is kept so you can re-check a transcript. By default a project keeps audio for 90 days after it was recorded, then deletes it while keeping the confirmed transcript. You can change this per project or delete any recording immediately.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Export and deletion</h2>
          <p className="mt-2">You can export a complete project (manuscript, answers and notes) at any time. Deleting a project removes its records and recordings from the live system immediately. Database point-in-time history and storage backups may retain copies for a limited period before they expire; the current retention window is described in project settings next to the delete control.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Mistakes and review</h2>
          <p className="mt-2">AI-generated passages can be wrong. Every passage links to the answers it was drafted from, and anything uncertain is flagged for you rather than smoothed over. Please read your book before you share it.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.4rem] text-ink">Encryption</h2>
          <p className="mt-2">Data is encrypted in transit and at rest by our hosting and storage providers. LifeStory does not currently offer end-to-end encryption.</p>
        </section>
      </div>
    </article>
  );
}
