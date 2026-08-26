import type { ReactNode } from "react";
import { Geist, Inter, JetBrains_Mono } from "next/font/google";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth.js";
import { Providers } from "./providers.js";
import { AppShell } from "./AppShell.js";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "TestPilot — Local AI QA Agent",
  description: "Connects to a GitHub repo, understands an already-implemented feature, generates Playwright tests, and reports whether it works.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body>
        <Providers>
          <AppShell signedIn={Boolean(session)} userName={session?.user?.name ?? null}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
