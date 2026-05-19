import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Firefly Studio",
  description: "Cozy ambient long-form video generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <header className="border-b border-amber-500/20 bg-gradient-to-b from-amber-50/40 to-transparent dark:from-amber-950/10">
            <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight hover:opacity-80 transition-opacity"
              >
                <span className="inline-block w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
                Firefly Studio
              </Link>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
