import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRobe — Cut the spam from your PRs",
  description:
    "AI-powered triage tool for open-source maintainers. Spot and close junk pull requests fast.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
