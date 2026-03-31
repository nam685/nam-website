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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var m={"/thinks":"#FF1744","/draws":"#a855f7","/codes":"#22c55e","/grinds":"#f59e0b","/listens":"#f97316","/reads":"#94a3b8","/plays":"#06b6d4","/watches":"#1e40af","/bets":"#db2777"};var p=location.pathname;var c=m[p]||m["/"+p.split("/")[1]];if(c)document.documentElement.style.setProperty("--accent",c)})()`,
          }}
        />
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
