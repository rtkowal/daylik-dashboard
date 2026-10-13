// Daylik decisions API — Cloudflare Worker + D1
// GET  /decisions?brief=<id>             -> wszystkie decyzje zespołu dla briefu
// PUT  /decisions  {brief_id, topic_id, user_name, decision, notes}  -> upsert
// GET  /export?brief=<id>                -> zagregowany JSON dla Phase 2
const VALID = new Set(["opener", "yes", "no", null]);

function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (data, status, h) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...h } });

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url);

    try {
      if (url.pathname === "/decisions" && req.method === "GET") {
        const brief = url.searchParams.get("brief");
        if (!brief) return json({ error: "brief required" }, 400, h);
        const { results } = await env.DB.prepare(
          "SELECT topic_id, user_name, decision, notes, updated_at FROM decisions WHERE brief_id = ?"
        ).bind(brief).all();
        return json(results, 200, h);
      }

      if (url.pathname === "/decisions" && req.method === "PUT") {
        const b = await req.json();
        const user = String(b.user_name || "").trim().slice(0, 40);
        const decision = b.decision ?? null;
        if (!b.brief_id || !b.topic_id || !user || !VALID.has(decision))
          return json({ error: "invalid payload" }, 400, h);
        await env.DB.prepare(
          `INSERT INTO decisions (brief_id, topic_id, user_name, decision, notes, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
           ON CONFLICT(brief_id, topic_id, user_name)
           DO UPDATE SET decision = ?4, notes = ?5, updated_at = datetime('now')`
        ).bind(String(b.brief_id), String(b.topic_id), user, decision, String(b.notes || "").slice(0, 5000)).run();
        return json({ ok: true }, 200, h);
      }

      if (url.pathname === "/export" && req.method === "GET") {
        const brief = url.searchParams.get("brief");
        const { results } = await env.DB.prepare(
          "SELECT topic_id, user_name, decision, notes, updated_at FROM decisions WHERE brief_id = ? ORDER BY topic_id, updated_at"
        ).bind(brief).all();
        const topics = {};
        let general = [];
        for (const r of results) {
          if (r.topic_id === "_general") { if (r.notes) general.push(`${r.user_name}: ${r.notes}`); continue; }
          const t = (topics[r.topic_id] ||= { id: r.topic_id, votes: { opener: [], yes: [], no: [] }, notes: [] });
          if (r.decision) t.votes[r.decision].push(r.user_name);
          if (r.notes) t.notes.push(`${r.user_name}: ${r.notes}`);
        }
        return json({ brief_id: brief, exported_at: new Date().toISOString(), topics: Object.values(topics), general_notes: general }, 200, h);
      }

      return json({ error: "not found" }, 404, h);
    } catch (e) {
      return json({ error: String(e) }, 500, h);
    }
  },
};
