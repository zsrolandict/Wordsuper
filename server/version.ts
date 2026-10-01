import { execFileSync } from "child_process";

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
  const date = git("log", "-1", "--format=%cs");
  return { commit: commit || "ismeretlen", date };
}
