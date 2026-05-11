import type { Metadata, Viewport } from "next"
import { Anton, Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { SwRegister } from "@/components/app/sw-register"

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
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SwRegister />
      </body>
    </html>
  )
}
