import type { Metadata, Viewport } from "next"
import { Anton, Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { PostHogProvider } from "@/components/app/posthog-provider"
import { PwaInstallPrompt } from "@/components/app/pwa-install-prompt"
import { SwRegister } from "@/components/app/sw-register"
import { Toaster } from "@/components/ui/sonner"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "MFO / Rink Reports",
  description: "Operations console for Max Facility ice rinks.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
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
