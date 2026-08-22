"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="card" style={{ maxWidth: 480, margin: "60px auto", textAlign: "center" }}>
      <h1 style={{ marginTop: 0 }}>Connect GitHub</h1>
      <p className="muted">
        Sign in with GitHub to browse the repositories you're authorized to access. TestPilot only
        reads your code to plan and run tests — it never modifies application source.
      </p>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => signIn("github", { callbackUrl: "/repositories" })}>
        Sign in with GitHub
      </button>
    </div>
  );
}
