import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Course Generator",
  description: "AI-powered multi-page course generator.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
