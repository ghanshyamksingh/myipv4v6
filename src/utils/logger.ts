import { maskIP } from './ip.ts';

export interface LogMeta {
  ip?: string;
  provider?: string;
  status?: number;
  message?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Privacy-preserving structured logger for Cloudflare Workers / Node.js.
 * Automatically masks full IP addresses to prevent raw visitor data leakage in logs.
 */
function sanitizeMeta(meta?: LogMeta): Record<string, any> | undefined {
  if (!meta) return undefined;
  const sanitized = { ...meta };
  if (sanitized.ip) {
    sanitized.ip = maskIP(sanitized.ip);
  }
  return sanitized;
}

export const logger = {
  info(event: string, meta?: LogMeta): void {
    const data = sanitizeMeta(meta);
    console.log(`[INFO] ${event}${data ? ` ${JSON.stringify(data)}` : ''}`);
  },

  warn(event: string, meta?: LogMeta): void {
    const data = sanitizeMeta(meta);
    console.warn(`[WARN] ${event}${data ? ` ${JSON.stringify(data)}` : ''}`);
  },

  error(event: string, meta?: LogMeta): void {
    const data = sanitizeMeta(meta);
    console.error(`[ERROR] ${event}${data ? ` ${JSON.stringify(data)}` : ''}`);
  },
};
