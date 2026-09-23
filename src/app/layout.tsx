import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "TeamOS", template: "%s · TeamOS" },
  description: "Team tasks and company finance in one place.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Toaster position="bottom-right" richColors toastOptions={{ className: "!rounded-xl" }} />
      </body>
    </html>
  );
}
