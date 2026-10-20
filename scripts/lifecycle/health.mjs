/**
 * Endpoint-specific health contracts. A status code alone never passes: each
 * component's contract (lifecycle.config.json) asserts content type and body.
 * A 404, an HTML error page where JSON is expected, or a JSON body missing the
 * contracted fields is UNHEALTHY with the reason recorded.
 */
import http from 'node:http';

export function httpGet(host, port, pathname, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: pathname, timeout: timeoutMs, headers: { Accept: '*/*' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 1 << 20) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, contentType: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), obj);
}

/** @returns {{ok: boolean, detail: string}} */
export function evaluateHealth(contract, response) {
  if (!response) return { ok: false, detail: 'no response' };
  if (response.status !== contract.status) return { ok: false, detail: `HTTP ${response.status}, expected ${contract.status}` };
  if (contract.content_type && !response.contentType.toLowerCase().startsWith(contract.content_type)) {
    return { ok: false, detail: `content-type '${response.contentType}', expected ${contract.content_type}` };
  }
  if (contract.json_has || contract.json_equals) {
    let doc;
    try { doc = JSON.parse(response.body); } catch { return { ok: false, detail: 'body is not JSON' }; }
    for (const k of contract.json_has ?? []) if (dig(doc, k) === undefined || dig(doc, k) === null) return { ok: false, detail: `JSON lacks '${k}'` };
    for (const [k, v] of Object.entries(contract.json_equals ?? {})) if (dig(doc, k) !== v) return { ok: false, detail: `JSON '${k}' is ${JSON.stringify(dig(doc, k))}, expected ${JSON.stringify(v)}` };
  }
  for (const s of contract.body_includes ?? []) if (!response.body.includes(s)) return { ok: false, detail: `body lacks ${JSON.stringify(s)}` };
  return { ok: true, detail: 'contract satisfied' };
}

export async function checkHealth(host, component, { getImpl = httpGet, timeoutMs = 3000 } = {}) {
  try {
    return evaluateHealth(component.health, await getImpl(host, component.port, component.health.path, { timeoutMs }));
  } catch (err) {
    return { ok: false, detail: `request failed: ${err.message}` };
  }
}
