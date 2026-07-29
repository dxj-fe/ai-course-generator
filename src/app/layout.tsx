import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/geist-sans.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/geist-mono.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "课芽",
    template: "%s | 课芽",
  },
  description: "一句话生成可交互的个性化课程。",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#eef8ea",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="h-full font-sans antialiased" lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full`}
      >
        {children}
      </body>
    </html>
  );
}
