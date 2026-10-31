// Read and write the marvin repo through the GitHub REST API.
// Every write is one commit on the branch; a file can only be overwritten after it was read
// at its current version (the app's equivalent of "pull before you write").

const API = "https://api.github.com";

export function b64ToText(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class Repo {
  constructor({ token, repo, branch = "main", fetchImpl = (...args) => fetch(...args) }) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.fetch = fetchImpl;
    this.readShas = new Map(); // path -> blob sha seen by read_file
    this.blobCache = new Map(); // blob sha -> text
  }

  async api(path, opts = {}) {
    const res = await this.fetch(`${API}/repos/${this.repo}${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async headCommit() {
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    return ref.object.sha;
  }

  // Map of path -> blob sha for every file at the branch head.
  async tree() {
    const t = await this.api(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    const files = new Map();
    for (const e of t.tree) if (e.type === "blob") files.set(e.path, e.sha);
    return files;
  }

  async blobText(sha) {
    if (!this.blobCache.has(sha)) {
      const b = await this.api(`/git/blobs/${sha}`);
      this.blobCache.set(sha, b64ToText(b.content));
    }
    return this.blobCache.get(sha);
  }

  async readFile(path) {
    const files = await this.tree();
    const sha = files.get(path);
    if (!sha) throw new Error(`No such file: ${path}`);
    const text = await this.blobText(sha);
    this.readShas.set(path, sha);
    return text;
  }

  async listFiles(prefix = "") {
    const files = await this.tree();
    return [...files.keys()].filter(
      (p) => p.startsWith(prefix) && (p.endsWith(".md") || !p.includes("/")) && !p.startsWith("app/"),
    );
  }

  // Case-insensitive search across notes. Every word must appear on the line.
  async search(query, limit = 40) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const files = await this.tree();
    const notes = [...files].filter(([p]) => p.endsWith(".md") && !p.startsWith("app/"));
    const hits = [];
    const queue = [...notes];
    const worker = async () => {
      while (queue.length) {
        const [path, sha] = queue.shift();
        const lines = (await this.blobText(sha)).split("\n");
        lines.forEach((line, i) => {
          const l = line.toLowerCase();
          if (words.every((w) => l.includes(w))) hits.push(`${path}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    hits.sort();
    return hits.slice(0, limit);
  }

  // files: [{path, content}] to create or overwrite; deletions: [path]. One commit.
  async commit(message, files = [], deletions = []) {
    if (!/^(remember|update|forget|persona|chore): .+/.test(message)) {
      throw new Error('Commit message must look like "<remember|update|forget|persona|chore>: <summary>"');
    }
    const head = await this.headCommit();
    const current = await this.tree();
    const stale = [...files.map((f) => f.path), ...deletions].filter(
      (p) => current.has(p) && this.readShas.get(p) !== current.get(p),
    );
    if (stale.length) {
      throw new Error(
        `Read these files first (they exist and may have changed since you last read them): ${stale.join(", ")}`,
      );
    }
    const missing = deletions.filter((p) => !current.has(p));
    if (missing.length) throw new Error(`Cannot delete missing files: ${missing.join(", ")}`);
    const commit = await this.api(`/git/commits/${head}`);
    const entries = [
      ...files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
      ...deletions.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null })),
    ];
    const tree = await this.api("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }),
    });
    const created = await this.api("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
    });
    await this.api(`/git/refs/heads/${this.branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: created.sha }),
    });
    // The new versions count as read, so follow-up edits in the same chat work.
    const after = await this.tree();
    for (const f of files) this.readShas.set(f.path, after.get(f.path));
    for (const p of deletions) this.readShas.delete(p);
    return created.sha.slice(0, 7);
  }
}
