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
  title: "firefly",
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
          <header className="border-b">
            <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                <span className="text-amber-500">●</span> firefly
              </Link>
              <nav className="flex items-center gap-4 text-sm text-muted-foreground">
                <Link href="/" className="hover:text-foreground">Projects</Link>
                <Link href="/new" className="hover:text-foreground">New</Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
