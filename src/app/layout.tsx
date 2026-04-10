import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Merriweather } from "next/font/google";
import "./globals.css";

const merriweather = Merriweather({
  weight: ["300", "400", "700"],
  subsets: ["latin"],
  variable: "--font-merriweather",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Artifact",
  description:
    "Read arXiv PDFs with full-text Q&A per paper. Your keys and chat history stay in the browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${merriweather.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
