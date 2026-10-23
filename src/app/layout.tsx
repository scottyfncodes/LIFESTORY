import type { Metadata, Viewport } from "next";
import { Newsreader, Source_Sans_3 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const PULSE_ORIGIN = "https://haveanapp-pulse-collect.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "LifeStory",
    template: "%s · LifeStory",
  },
  description:
    "A personal biographer for everyone. Your memories. Your voice. Your story, beautifully told.",
  applicationName: "LifeStory",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "LifeStory",
    statusBarStyle: "default",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f7f2e9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sourceSans.variable} ${newsreader.variable}`}>
      <body>
        {children}
        {/* HaveAnApp Pulse: anonymous, cookieless page view counts. Page paths only, never memoir content. */}
        <Script src={`${PULSE_ORIGIN}/p.js`} data-app="lifestory" strategy="afterInteractive" />
      </body>
    </html>
  );
}
