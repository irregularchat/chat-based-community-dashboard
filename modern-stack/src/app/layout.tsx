import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthSessionProvider from "@/components/providers/session-provider";
import TRPCProvider from "@/components/providers/trpc-provider";
import { Toaster } from "@/components/ui/sonner";
import NavigationHeader from "@/components/navigation-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Community Dashboard",
  description: "Modern community management and Matrix integration dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthSessionProvider>
          <TRPCProvider>
            <NavigationHeader />
            <main className="flex-1">
              {children}
            </main>
            <Toaster />
          </TRPCProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
