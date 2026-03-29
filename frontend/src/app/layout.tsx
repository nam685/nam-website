import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PageBackground from "@/components/PageBackground";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-headline",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nam Le",
    template: "Nam %s",
  },
  description: "Personal website",
  icons: { icon: "/favicon.svg" },
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <div className="fixed inset-0 scanline z-[200] opacity-15 pointer-events-none" />
        <PageBackground />
        <Navbar />
        {children}
      </body>
    </html>
  );
}
