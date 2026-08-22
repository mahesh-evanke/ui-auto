export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isOrg: boolean;
  description: string | null;
  language: string | null;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
  cloneUrl: string;
  sizeKb: number;
}

export interface GithubBranch {
  name: string;
  protected: boolean;
}

const GITHUB_API = "https://api.github.com";

async function githubFetch(token: string, path: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

/**
 * Lists repositories the signed-in user can access (owned + collaborator +
 * org, public and private - whatever the OAuth scope grants), across a few
 * pages. Search/filter/sort happen client-side in the Repository Browser UI
 * against this list (doc section 4) rather than hitting GitHub's Search API.
 */
export async function listRepos(token: string, maxPages = 3): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await githubFetch(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`
    );
    if (!res.ok) {
      throw new Error(`GitHub API error listing repos (${res.status}): ${await res.text().catch(() => "")}`);
    }
    const batch = (await res.json()) as any[];
    for (const r of batch) {
      repos.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login ?? "",
        isOrg: r.owner?.type === "Organization",
        description: r.description,
        language: r.language,
        visibility: r.private ? "private" : "public",
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        sizeKb: r.size,
      });
    }
    if (batch.length < 100) break;
  }
  return repos;
}

export async function listBranches(token: string, owner: string, repo: string): Promise<GithubBranch[]> {
  const res = await githubFetch(token, `/repos/${owner}/${repo}/branches?per_page=100`);
  if (!res.ok) {
    throw new Error(`GitHub API error listing branches (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const batch = (await res.json()) as any[];
  return batch.map((b) => ({ name: b.name, protected: Boolean(b.protected) }));
}
