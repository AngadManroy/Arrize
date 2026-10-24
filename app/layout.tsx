import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-display", display: "swap" });
const mono = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Arrize: your AI quest architect",
  description: "Tell Arrize what you want to learn. It turns your goal into daily quests, adapts when you slip, and holds you to a weekly Death Quest.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Arrize", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#04060e", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
