import type { AuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

/**
 * The GitHub access token is captured into the signed JWT (jwt callback) but
 * deliberately NOT copied into the client-visible session object (session
 * callback below only exposes user profile fields). Server-side API routes
 * read the raw token via next-auth/jwt's getToken(), so it never reaches
 * browser JS - see lib/githubClient.ts callers in app/api/github/*.
 */
export const authOptions: AuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
      authorization: { params: { scope: "read:user repo" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session }) {
      // Intentionally do not attach accessToken here - keep it server-only.
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
};
