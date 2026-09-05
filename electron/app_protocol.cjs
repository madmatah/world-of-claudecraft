'use strict';

// The `app://` protocol handler: the shell's own origin, serving the packaged
// dist/ with the content security policy on every response, 206 slices for
// media, and the SPA fallback for extension-less paths. Extracted from
// main.cjs so the GPU backend probe's child mode (electron/backend_probe_child.cjs),
// which returns from main.cjs before its module scope, can register the same
// handler; the scheme PRIVILEGES stay a literal in main.cjs (Electron reads
// them before ready, and the tests pin that literal there). Pinned by
// tests/electron_media_range.test.ts.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { net, protocol } = require('electron');
const {
  buildContentSecurityPolicy,
  extractInlineScriptHashes,
  withCspHeader,
} = require('./shell_guards.cjs');
const { rangeContentType, rangedFileResponse } = require('./media_range.cjs');

function fileInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function registerAppProtocol({ apiOrigin, distDir = path.join(__dirname, '..', 'dist') }) {
  // Build the CSP once from the shipped index.html: hash its inline bootstrap scripts
  // (their content is build-dependent) so a strict script-src allows them without
  // 'unsafe-inline'. In dev the window loads the Vite server and this app:// handler
  // is never hit, so a missing dist here is harmless.
  let scriptHashes = [];
  try {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    scriptHashes = extractInlineScriptHashes(html);
  } catch {
    scriptHashes = [];
  }
  const csp = buildContentSecurityPolicy({ apiOrigin, scriptHashes });
  const notFound = () =>
    new Response('not found', { status: 404, headers: { 'Content-Security-Policy': csp } });
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const candidate = path.normalize(path.join(distDir, requestedPath));
    if (!fileInside(distDir, candidate)) {
      return notFound();
    }
    const hasExtension = path.extname(candidate) !== '';
    const filePath = fs.existsSync(candidate)
      ? candidate
      : hasExtension
        ? candidate
        : path.join(distDir, 'index.html');
    if (!fs.existsSync(filePath) || !fileInside(distDir, filePath)) {
      return notFound();
    }
    // Chromium's media stack requests <audio>/<video> sources with a Range header
    // and rejects a plain 200 re-wrap as a format error, which left every streamed
    // music cue silent in the shipped shell. Serve those as proper 206 slices (or
    // a 416 for a past-EOF range) via electron/media_range.cjs; a null (non-media
    // file, malformed range, unreadable file) falls through to the full response.
    const rangeValue = request.headers.get('range');
    if (rangeValue) {
      const ranged = await rangedFileResponse(filePath, rangeValue, {
        'Content-Security-Policy': csp,
      });
      if (ranged) return ranged;
    }
    // Every served path (asset or the SPA index.html fallback) gets the CSP header;
    // net.fetch's own Response has immutable headers, so withCspHeader builds a fresh
    // one that preserves the body, status, statusText, and Content-Type. Media files
    // also advertise Accept-Ranges here, so range support is visible to a client
    // that probes the full response before sending its first ranged request.
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const full = withCspHeader(response, csp);
    if (rangeContentType(filePath)) full.headers.set('Accept-Ranges', 'bytes');
    return full;
  });
}

module.exports = { fileInside, registerAppProtocol };
