'use strict';
const { cpSync, mkdirSync, rmSync, readdirSync } = require('node:fs');
const { extname } = require('node:path');

// The existing application is a static site: preserve every top-level page and asset.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const entry of readdirSync('.', { withFileTypes: true })) {
  if (entry.isFile() && ['.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.json'].includes(extname(entry.name)) && !['build.js', 'package.json', 'package-lock.json'].includes(entry.name)) {
    cpSync(entry.name, `dist/${entry.name}`);
  }
}
