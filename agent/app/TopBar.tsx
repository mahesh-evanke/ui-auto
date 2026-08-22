"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";

export function TopBar({ signedIn, userName }: { signedIn: boolean; userName: string | null }) {
  return (
    <div className="topbar">
      <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
        TestPilot
      </Link>
      <nav style={{ display: "flex", alignItems: "center" }}>
        {signedIn ? (
          <>
            <Link href="/repositories">Repositories</Link>
            <Link href="/settings">Settings</Link>
            <span className="muted" style={{ marginLeft: 16 }}>{userName}</span>
            <button
              className="btn secondary"
              style={{ marginLeft: 16, padding: "6px 12px" }}
              onClick={() => signOut({ callbackUrl: "/signin" })}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link href="/signin">Sign in</Link>
        )}
      </nav>
    </div>
  );
}
