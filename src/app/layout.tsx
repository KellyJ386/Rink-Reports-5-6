import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import "./globals.css"
import { PostHogProvider } from "@/components/app/posthog-provider"
import { PwaInstallPrompt } from "@/components/app/pwa-install-prompt"
import { SwRegister } from "@/components/app/sw-register"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "Rink Reports | Ice Rink Operations Platform",
  description:
    "The operations platform built for ice rinks. Daily reports, refrigeration logs, ice depth, air quality, and scheduling — offline-first, on any device.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Rink Reports",
  },
}

export const viewport: Viewport = {
  themeColor: "#001A3A",
  width: "device-width",
  initialScale: 1,
  // viewportFit:'cover' lets the WebView extend behind iOS safe-area
  // insets; the body padding in globals.css restores breathing room.
  // maximumScale is left at the default (allow pinch-zoom) — restricting
  // it breaks WCAG 1.4.4 for low-vision users.
  viewportFit: "cover",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Per-request CSP nonce set by the proxy (src/lib/supabase/session.ts).
  // The inline theme script below must carry it, otherwise the nonce-based
  // script-src blocks it and the pre-paint theme is lost. Undefined in dev,
  // where CSP is not enforced.
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        {/*
          Apply the saved theme before paint to avoid a flash. When no
          choice is saved, fall back to the OS preference (prefers-color-scheme)
          so new users get the mode that matches their system. Once they pick
          via ThemeToggle, localStorage.rr-theme takes over.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('rr-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.add(t);}catch(e){document.documentElement.classList.add('light');}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        {children}
        <SwRegister />
        <PwaInstallPrompt />
        <PostHogProvider />
        <Toaster />
      </body>
    </html>
  )
}
