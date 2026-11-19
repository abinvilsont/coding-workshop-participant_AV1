// The PWA pieces are static files; check they stay consistent with each other.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const pngSize = (p) => {
  const buf = readFileSync(resolve(root, 'public', p.replace(/^\//, '')));
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
};

describe('installable app (PWA)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  it('has a manifest browsers accept for install', () => {
    expect(manifest).toMatchObject({ name: 'ACME Facility Desk', start_url: '/', display: 'standalone' });
    const sizes = manifest.icons.map((i) => `${i.sizes}/${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']));
  });

  it('points at icons that exist and really have the stated size', () => {
    for (const icon of manifest.icons) expect(pngSize(icon.src)).toBe(icon.sizes);
    expect(pngSize('/icons/apple-touch-icon.png')).toBe('180x180');
  });

  it('links the manifest, theme colour and icons from the page', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
    expect(html).toContain('href="/icons/apple-touch-icon.png"');
    expect(existsSync(resolve(root, 'public/icons/icon.svg'))).toBe(true);
  });

  it('never caches the API, and precaches only files that exist', () => {
    const sw = read('public/sw.js');
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api\/'\)\) return;/);
    const shell = JSON.parse(sw.match(/const SHELL = (\[.*?\]);/)[1].replace(/'/g, '"'));
    for (const file of shell.filter((f) => f !== '/')) {
      expect(existsSync(resolve(root, file === '/index.html' ? 'index.html' : `public${file}`)), file).toBe(true);
    }
  });
});
