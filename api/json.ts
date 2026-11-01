// Vercel serverless function: same-origin JSON proxy.
// The frontend calls  /api/json?url=<encoded upstream url>  and this function
// fetches the upstream server-side, which avoids CORS problems and the
// dependency on a third-party proxy (e.g. corsproxy.io, which blocks
// production origins).

const DEFAULT_ALLOWED_HOSTS = [
  'public-miruro-consumet-api.vercel.app',
  'api.aniskip.com',
];

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function allowedHosts(): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const v of [process.env.VITE_BACKEND_URL, process.env.VITE_SKIP_TIMES]) {
    const h = hostOf(v);
    if (h) hosts.add(h);
  }
  return hosts;
}

export default async function handler(req: any, res: any) {
  const raw = req.query?.url;
  const target = Array.isArray(raw) ? raw[0] : raw;

  if (!target || typeof target !== 'string') {
    return res.status(400).json({ message: 'Missing "url" query parameter' });
  }

  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    return res.status(400).json({ message: 'Invalid "url" parameter' });
  }

  if (
    !['http:', 'https:'].includes(upstream.protocol) ||
    !allowedHosts().has(upstream.hostname)
  ) {
    return res.status(403).json({ message: 'Host not allowed' });
  }

  try {
    const response = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    const body = await response.text();

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cache successful responses at the edge to cut load on the upstream API.
    if (response.ok) {
      res.setHeader(
        'Cache-Control',
        's-maxage=300, stale-while-revalidate=600',
      );
    }
    return res.status(response.status).send(body);
  } catch (error: any) {
    return res
      .status(502)
      .json({ message: `Upstream request failed: ${error?.message ?? error}` });
  }
}
