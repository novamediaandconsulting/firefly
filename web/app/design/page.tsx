"use client";

import { LOGOS, FAVICONS } from "@/components/logo-options";
import { Card, CardContent } from "@/components/ui/card";

export default function DesignPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-extrabold tracking-tight">Design picker</h1>
        <p className="text-lg text-muted-foreground">
          Pick a logo and favicon. Tell me the numbers — I&apos;ll wire the
          chosen ones into the app.
        </p>
      </header>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Logos (20)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Header-scale (32-48px). Click to preview at full size.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {LOGOS.map((logo) => (
            <Card
              key={logo.id}
              className="hover:border-amber-500 transition-colors"
            >
              <CardContent className="p-5 flex flex-col items-center gap-3">
                <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-6">
                  {logo.render({ size: 80 })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-mono font-bold text-amber-500">
                    {logo.id}
                  </span>
                  <span className="text-sm font-semibold">{logo.name}</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {logo.description}
                </p>
                <div className="flex items-center gap-3 pt-2 border-t w-full justify-center">
                  <span className="text-xs text-muted-foreground">small</span>
                  {logo.render({ size: 24 })}
                  {logo.render({ size: 40 })}
                  <span className="text-xs text-muted-foreground">large</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Favicons (10)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Browser tab scale (16-32px). Must read clearly tiny.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {FAVICONS.map((fav) => (
            <Card
              key={fav.id}
              className="hover:border-amber-500 transition-colors"
            >
              <CardContent className="p-5 flex flex-col items-center gap-3">
                {/* Tab-strip preview */}
                <div className="bg-zinc-200 dark:bg-zinc-800 rounded-md p-2 flex items-center gap-2 w-full">
                  {fav.render({ size: 16 })}
                  <span className="text-xs truncate text-zinc-700 dark:text-zinc-300">
                    firefly
                  </span>
                </div>
                {/* Larger preview */}
                <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4">
                  {fav.render({ size: 64 })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-mono font-bold text-amber-500">
                    {fav.id}
                  </span>
                  <span className="text-sm font-semibold">{fav.name}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="rounded-xl border-2 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-6">
        <h3 className="text-lg font-bold">When you&apos;ve picked</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Tell me e.g. <code className="bg-background px-1.5 py-0.5 rounded font-mono">logo #7 + favicon #2</code>{" "}
          and I&apos;ll swap them into the live header + browser tab.
        </p>
      </div>
    </div>
  );
}
