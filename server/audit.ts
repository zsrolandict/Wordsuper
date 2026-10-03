import fs from "fs";
import type { TokenUsage } from "./ai/types";

/**
 * Audit trail: one JSON line per AI operation, with metadata only. Document text, instructions, answers and
 * recordings are never written here. Lines go to stdout (Cloud Logging on Cloud Run) and, when AUDIT_LOG_FILE is
 * set, are appended to that file too.
 */
export interface AuditEntry {
  /** Who: the Microsoft work account or the owner of a personal access key (verified), or the ID typed in the task pane's settings (not verified) */
  user: string;
  verified?: boolean;
  /** How the user signed in: Microsoft account, personal access key or the shared key */
  auth?: "microsoft" | "personal-key" | "shared-key";
  ip: string;
  action: string;
  status: "ok" | "incomplete" | "error" | "aborted" | "rejected";
  /** Sizes in characters, not the texts */
  chars?: { selection: number; context: number; history: number };
  masked?: boolean;
  /** How many values were replaced by placeholders on the client */
  maskedValues?: number;
  wholeDocument?: boolean;
  depth?: string;
  audioBytes?: number;
  model: string;
  location: string;
  durationMs: number;
  tokens?: TokenUsage;
  /** Why the model stopped, or the error code */
  detail?: string;
}

export type AuditLogger = (entry: AuditEntry) => void;

const MAX_USER_CHARS = 100;

/** The user ID arrives URI-encoded (headers can't carry accented characters); control characters are dropped */
export function readUserId(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Not encoded: keep it as it came
  }
  return decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_USER_CHARS);
}

export function createAuditLogger(file: string | undefined, write: (line: string) => void = line => console.log(line)): AuditLogger {
  const path = file?.trim();
  return (entry) => {
    const line = JSON.stringify({ type: "audit", time: new Date().toISOString(), ...entry });
    write(line);
    if (path) {
      fs.appendFile(path, line + "\n", (error) => {
        if (error) console.error(`Audit log could not be written to ${path}:`, error.message);
      });
    }
  };
}
