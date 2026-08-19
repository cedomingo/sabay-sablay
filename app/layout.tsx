import type { Metadata } from "next";
import "./globals.css";
import Toast from "@/components/Toast";

export const metadata: Metadata = {
  title: "Sabay Sablay",
  description: "Group schedule visualizer and planner for students.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SabaySablay",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#214746",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased bg-paper text-ink">
        {children}
        <Toast />
      </body>
    </html>
  );
}
