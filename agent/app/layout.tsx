import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth.js";
import { Providers } from "./providers.js";
import { TopBar } from "./TopBar.js";
import "./globals.css";

export const metadata = {
  title: "TestPilot — Local AI QA Agent",
  description: "Connects to a GitHub repo, understands an already-implemented feature, generates Playwright tests, and reports whether it works.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en">
      <body>
        <Providers>
          <TopBar signedIn={Boolean(session)} userName={session?.user?.name ?? null} />
          <div className="container">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
