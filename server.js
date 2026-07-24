'use strict';

/**
 * Minimal, zero-dependency static server for the 20FIT Talent bundled page.
 *
 * The project is a single self-contained ("offline") HTML file, so there is
 * nothing to compile or bundle at runtime — we just serve that one file.
 *
 * Production notes (Railway / any PaaS):
 *   - The port is read from the PORT environment variable (Railway injects it).
 *   - The server binds to 0.0.0.0 so it is reachable outside the container.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

/**
 * Decide which HTML file to serve. Priority:
 *   1. HTML_FILE env var (explicit override)
 *   2. index.html
 *   3. the first *.html file found in this directory
 */
function resolveHtmlFile() {
  if (process.env.HTML_FILE) return process.env.HTML_FILE;

  const entries = fs.readdirSync(__dirname);
  if (entries.includes('index.html')) return 'index.html';

  const html = entries.find((f) => f.toLowerCase().endsWith('.html'));
  if (!html) {
    throw new Error('No .html file found in ' + __dirname + ' to serve.');
  }
  return html;
}

const htmlPath = path.join(__dirname, resolveHtmlFile());

// Read the file once at startup and keep it in memory. It is a small,
// static bundle, so caching it avoids a disk read on every request.
const htmlBuffer = fs.readFileSync(htmlPath);

const server = http.createServer((req, res) => {
  // Lightweight health check for Railway / uptime monitors.
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  // Everything else serves the single bundled page.
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': htmlBuffer.length,
    'Cache-Control': 'public, max-age=300',
  });
  res.end(htmlBuffer);
});

server.listen(PORT, HOST, () => {
  console.log('20FIT Talent server running at http://' + HOST + ':' + PORT);
  console.log('Serving file: ' + path.basename(htmlPath));
});
