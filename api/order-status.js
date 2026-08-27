// /api/order-status — status do pedido para o cliente acompanhar em "Meus pedidos".
//   POST { companyId, statuses: { orderId: {status, updatedAt, nome, total, tipoLabel, tipoEntrega} } }
//        → o admin publica o andamento (recebido → cozinha → entrega → finalizado).
//   GET  ?company=<id>&ids=a,b,c
//        → o cliente lê o status dos SEUS pedidos (só quem tem o id do pedido vê).
// Grava/le via firebase-admin (conta de serviço), então NÃO depende de regras do
// Realtime Database nem de login do cliente. Mesmo padrão do /api/order.
const admin = require("firebase-admin");

function loadServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw && b64) { const t = String(b64).trim(); raw = t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8"); }
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT ausente");
  try { return JSON.parse(raw); } catch (e) {}
  const s = raw.indexOf("{");
  if (s < 0) throw new Error("conta de serviço sem JSON válido");
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { if (--depth === 0) return JSON.parse(raw.slice(s, i + 1)); }
  }
  throw new Error("JSON da conta de serviço incompleto");
}

function initAdmin() {
  if (admin.apps.length) return admin.app();
  const sa = loadServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com`,
  });
}

const str = (v, max) => String(v == null ? "" : v).slice(0, max || 200);
const ALLOWED = ["recebido", "cozinha", "entrega", "finalizado"];

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const app = initAdmin();
    const db = admin.database(app);

    if (req.method === "GET") {
      const companyId = str(req.query.company, 60).replace(/[^\w-]/g, "");
      const ids = str(req.query.ids, 2000).split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
      if (!companyId || !ids.length) return res.status(200).json({ statuses: {} });
      const base = db.ref(`/orderStatus/gestaoCompany_${companyId}_v1`);
      const out = {};
      await Promise.all(ids.map(async (id) => {
        try { const snap = await base.child(id).get(); if (snap.exists()) out[id] = snap.val(); } catch (e) {}
      }));
      return res.status(200).json({ statuses: out });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const companyId = str(body.companyId, 60).replace(/[^\w-]/g, "");
      const statuses = body.statuses && typeof body.statuses === "object" ? body.statuses : null;
      if (!companyId || !statuses) return res.status(400).json({ error: "companyId/statuses ausentes" });
      const entries = Object.entries(statuses).slice(0, 100);
      const updates = {};
      for (const [orderId, s] of entries) {
        const id = str(orderId, 60).replace(/[^\w-]/g, "");
        if (!id || !s || typeof s !== "object") continue;
        const status = ALLOWED.includes(s.status) ? s.status : "recebido";
        updates[id] = {
          status,
          updatedAt: Number(s.updatedAt) || Date.now(),
          nome: str(s.nome, 120),
          total: Number(s.total) || 0,
          tipoLabel: str(s.tipoLabel, 60),
          tipoEntrega: str(s.tipoEntrega, 20),
        };
      }
      if (Object.keys(updates).length) {
        await db.ref(`/orderStatus/gestaoCompany_${companyId}_v1`).update(updates);
      }
      return res.status(200).json({ ok: true, count: Object.keys(updates).length });
    }

    return res.status(405).json({ error: "método não permitido" });
  } catch (e) {
    return res.status(500).json({ error: "falha no status", detail: String((e && e.message) || e) });
  }
};
