const cheerio = require("cheerio");

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function pick($ctx, rule) {
  if (!rule || !rule.selector) return null;
  const $el = $ctx(rule.selector);
  const readOne = (el) => {
    let val;
    if (rule.attr && rule.attr !== "text") val = $ctx(el).attr(rule.attr);
    else if (rule.type === "html")       val = $ctx(el).html();
    else                                 val = $ctx(el).text();
    if (rule.trim !== false && typeof val === "string") val = val.trim();
    if (rule.regex && typeof val === "string") {
      const m = new RegExp(rule.regex).exec(val);
      if (m) val = m[1] ?? m[0];
    }
    if (rule.type === "number") {
      const n = Number(String(val).replace(/[^\d.,-]+/g, "").replace(",", "."));
      return isNaN(n) ? null : n;
    }
    return val ?? null;
  };
  if (rule.all) return $el.map((_, el) => readOne(el)).get();
  const el = $el.first(); if (!el || el.length === 0) return null;
  return readOne(el);
}
function pickList($, listRule) {
  const out = [];
  $(listRule.selector).each((_, li) => {
    const row = {};
    const $scope = (sel) => $(li).find(sel);
    for (const [k, r] of Object.entries(listRule.fields || {})) row[k] = pick($scope, r);
    out.push(row);
  });
  return out;
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    let url, rules, ttl;
    if (req.method === "GET") {
      url = req.query.url;
      ttl = req.query.ttl ? Number(req.query.ttl) : 0;
      const raw = req.query.rules;
      if (raw) {
        try { rules = JSON.parse(raw); }
        catch { rules = JSON.parse(Buffer.from(raw, "base64").toString("utf-8")); }
      }
    } else {
      ({ url, rules, ttl } = req.body || {});
    }
    if (!url)  return res.status(400).json({ error: "Missing 'url'." });
    if (!rules) return res.status(400).json({ error: "Missing 'rules'." });

    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) return res.status(500).json({ error: "Missing BROWSERLESS_TOKEN env var" });

    const rendered =
      `https://chrome.browserless.io/content?token=${token}` +
      `&url=${encodeURIComponent(url)}&gotoWaitUntil=networkidle0&timeout=30000`;

    const r = await fetch(rendered);
    if (!r.ok) return res.status(r.status).json({ error: `Browserless ${r.status}`, url });
    const html = await r.text();

    const $ = cheerio.load(html);
    const out = { url, extractedAt: new Date().toISOString(), data: {} };

    if (rules.fields) out.data =
      Object.fromEntries(Object.entries(rules.fields).map(([k, v]) => [k, pick($, v)]));
    if (rules.lists) for (const [k, def] of Object.entries(rules.lists)) out.data[k] = pickList($, def);

    if (ttl && ttl > 0) res.setHeader("Cache-Control", `s-maxage=${ttl}, stale-while-revalidate=60`);
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
