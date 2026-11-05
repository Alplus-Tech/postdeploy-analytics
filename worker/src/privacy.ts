import { invalid } from './sql.ts';

export function hostname(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || !value || /[\s/:@?#%\\]/u.test(value)) throw invalid('Use a hostname without scheme, path, port or credentials.');
  let host: string;
  try { host = new URL(`https://${value.replace(/\.$/, '')}`).hostname.toLowerCase(); } catch { throw invalid('Invalid hostname.'); }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(host)) throw invalid('Use a DNS hostname such as example.com.');
  return host;
}

export function aliases(value: unknown, canonical: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw invalid('Use at most 20 aliases.');
  return [...new Set(value.map(hostname))].filter(h => h !== canonical);
}

export function safePath(value: string): string | null {
  if (value.length > 512) return null;
  let path = value;
  try {
    for (let i = 0; i < 4 && path.includes('%'); i++) path = decodeURIComponent(path);
  } catch { return null; }
  if (!path.startsWith('/') || /[%\\?#\u0000-\u0020\u007f]/u.test(path)) return null;
  path = path.normalize('NFC').replace(/\/{2,}/g, '/');
  if (path.split('/').some(p => p === '.' || p === '..')) return null;
  return path;
}

export function excludedPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw invalid('Use at most 20 excluded path prefixes.');
  return [...new Set(value.map(p => {
    if (typeof p !== 'string') throw invalid('Paths must be strings.');
    const path = safePath(p);
    if (!path) throw invalid('Use absolute paths of at most 512 characters without queries, fragments or ambiguous encoding.');
    return path === '/' ? path : path.replace(/\/$/, '');
  }))];
}

export function pathExcluded(path: string, rules: readonly string[]): boolean {
  return rules.some(rule => rule === '/' || path === rule || path.startsWith(`${rule}/`));
}
