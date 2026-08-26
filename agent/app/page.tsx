import { redirect } from "next/navigation";

// The dashboard (repositories) is the single entry point for everyone -
// signed in or not. Signed-out visitors see a "Sign in with GitHub" button
// in the top bar plus the "Analyze by URL" option, instead of being routed
// through a separate sign-in page.
export default function HomePage() {
  redirect("/repositories");
}
