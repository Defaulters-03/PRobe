/**
 * Parses any GitHub repository input and extracts the normalized "owner/repo".
 *
 * Rules:
 * 1. Trim whitespace. Accept "owner/repo" directly.
 * 2. Accept URLs with or without https://, with or without www., e.g. github.com/owner/repo.
 * 3. Accept any extra path after the repo: /pulls, /pull/123, /issues, /tree/main/src, /blob/...,
 *    /commits, plus trailing slashes, ?query strings and #hashes. Only first two path segments matter.
 * 4. Strip a trailing ".git". Also accept git@github.com:owner/repo.git.
 * 5. Valid owner/repo characters: letters, numbers, ".", "_", "-". Reject anything else.
 * 6. If invalid or not github.com link and not owner/repo, return null.
 */
export function parseRepoInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let str = trimmed;

  // 1. Strip query strings and hash anchors
  str = str.split("?")[0].split("#")[0];

  // 2. Handle SSH format git@github.com:owner/repo
  if (/^git@github\.com:/i.test(str)) {
    str = str.replace(/^git@github\.com:/i, "");
  } else {
    // 3. Handle HTTP/HTTPS and www.
    const hasProtocol = /^https?:\/\//i.test(str);
    str = str.replace(/^https?:\/\//i, "");
    str = str.replace(/^www\./i, "");

    // 4. Check for github.com domain
    if (/^github\.com[\/:]/i.test(str)) {
      str = str.replace(/^github\.com[\/:]/i, "");
    } else if (hasProtocol) {
      // Specified a protocol with a non-github domain (e.g. https://gitlab.com/...)
      return null;
    }
  }

  // 5. Trim leading and trailing slashes
  str = str.replace(/^\/+|\/+$/g, "");

  // 6. Split by path segments
  const segments = str.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0].trim();
  let repo = segments[1].trim();

  // 7. Strip trailing .git
  if (repo.toLowerCase().endsWith(".git")) {
    repo = repo.slice(0, -4);
  }

  // 8. Reject if owner looks like a foreign domain (e.g. gitlab.com/owner/repo without protocol)
  if (/\.(com|org|net|io|dev|ai|app|co|me|info|edu|gov)$/i.test(owner)) {
    return null;
  }

  // 9. Validate allowed characters: letters, numbers, '.', '_', '-'
  const validCharRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!validCharRegex.test(owner) || !validCharRegex.test(repo)) {
    return null;
  }

  return `${owner}/${repo}`;
}
