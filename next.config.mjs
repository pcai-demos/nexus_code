// Allow connections to internal LLM endpoints with self-signed certificates

// IDE host — defaults to localhost:8443 for local dev, overridden in K8s
const ideHost = process.env.IDE_HOST || "localhost:8443";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // T22 (design D3): `output: 'standalone'` removed — the runtime needs the full
  // tree (src/lib/ingestion/docling_bridge.py, public/, every cwd-rooted path),
  // and `next start` warned about it at every boot (t22-design.md §0 item 10).
  allowedDevOrigins: ['nexcode.demo.lon-pcai.twlon.com', 'nexus-finnex-demo.demo.lon-pcai.twlon.com'],
  skipMiddlewareUrlNormalize: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // code-server main routes
      {
        source: '/ide',
        destination: `http://${ideHost}/`,
      },
      {
        source: '/ide/',
        destination: `http://${ideHost}/`,
      },
      {
        source: '/ide/:path*',
        destination: `http://${ideHost}/:path*`,
      },
      // code-server VS Code workbench assets use absolute paths starting
      // with /stable-<hash>/... and /_static/... — proxy these too
      {
        source: '/stable-:hash/:path*',
        destination: `http://${ideHost}/stable-:hash/:path*`,
      },
      {
        source: '/_static/:path*',
        destination: `http://${ideHost}/_static/:path*`,
      },
    ];
  },
};

export default nextConfig;
