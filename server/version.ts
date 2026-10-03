import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Which version of the code is running: the short git commit and its date. Shown in the task pane's settings next
 * to the version of the page the task pane loaded, so a stale server or a cached page is visible at a glance.
 */
export function readVersion(cwd = process.cwd()): { commit: string; date: string } {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    } catch {
      return "";
    }
  };
  const commit = git("rev-parse", "--short", "HEAD");
  if (commit) return { commit, date: git("log", "-1", "--format=%cs") };
  // In a container there is no git: the deploy script writes version.json next to package.json
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(cwd, "version.json"), "utf8"));
    if (typeof saved?.commit === "string" && saved.commit) return { commit: saved.commit, date: typeof saved.date === "string" ? saved.date : "" };
  } catch {
    // no file: unknown
  }
  return { commit: "ismeretlen", date: "" };
}
