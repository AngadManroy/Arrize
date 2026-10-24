import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arise — Level up your life",
  description: "An AI Quest Architect turns your goal into daily quests. Stake on a Death Quest; the System checks your work.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#05070d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
