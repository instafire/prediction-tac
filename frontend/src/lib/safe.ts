import { ethers } from "ethers";
import type { CSSProperties } from "react";

/** Safe JSON parse for localStorage values. */
export function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function safeLocalRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/** Human-readable error from ethers / wallet / unknown. */
export function errMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e == null) return fallback;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as { shortMessage?: string; reason?: string; message?: string; code?: string | number };
    if (o.code === 4001 || o.code === "ACTION_REJECTED") return "Request rejected in wallet";
    if (typeof o.shortMessage === "string" && o.shortMessage) return o.shortMessage;
    if (typeof o.reason === "string" && o.reason) return o.reason;
    if (typeof o.message === "string" && o.message) {
      // Strip noisy ethers prefixes
      return o.message.replace(/^execution reverted:\s*/i, "").slice(0, 200);
    }
  }
  return fallback;
}

/** Parse ether amount; null if invalid / non-positive when required. */
export function parseEtherSafe(value: string, opts?: { allowZero?: boolean }): bigint | null {
  const t = value.trim();
  if (!t) return null;
  try {
    const w = ethers.parseEther(t);
    if (!opts?.allowZero && w <= 0n) return null;
    if (w < 0n) return null;
    return w;
  } catch {
    return null;
  }
}

/** Validate RPC URL for client config (http(s) only, no credentials in URL). */
export function isValidRpc(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (!u.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

/** Only allow http(s) absolute links for user-supplied resolution sources. */
export function safeHttpUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** CSS custom property helper (avoids `as any`). */
export function delayStyle(ms: number): CSSProperties {
  return { ["--d" as string]: `${ms}ms` } as CSSProperties;
}

/** Clamp array length for claimMany gas safety. */
export function chunkIds(ids: number[], max = 50): number[] {
  return ids.slice(0, max);
}
