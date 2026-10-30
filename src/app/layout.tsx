import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APOS — Work, thoughtfully organized",
  description: "A considered workspace for your documents and everyday office work."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
