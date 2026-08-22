import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../lib/auth.js";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  redirect(session ? "/repositories" : "/signin");
}
