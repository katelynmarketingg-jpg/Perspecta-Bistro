// /api/my-orders — Acesso do cliente: histórico de pedidos por TELEFONE.
// O cliente entra com nome + telefone no cardápio e vê todos os pedidos dele,
// mesmo os feitos em outro aparelho. Lê o índice /customers/<loja>/<telefone>
// (gravado pelo /api/order) e junta o status atual de /orderStatus.
//   GET ?companyId=X&phone=Y  → { orders: [ {id, nome, total, tipoLabel, tipoEntrega, itensCount, ts, status} ] }
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "método não permitido" });
  try {
    const companyId = str(req.query.companyId || req.query.company, 60).replace(/[^\w-]/g, "");
    const phone = str(req.query.phone, 20).replace(/\D/g, "");
    if (!companyId || !phone) return res.status(400).json({ error: "companyId/phone ausentes" });

    const app = initAdmin();
    const db = admin.database(app);
    const idx = (await db.ref(`/customers/gestaoCompany_${companyId}_v1/${phone}`).get()).val() || {};
    const list = Object.values(idx);
    if (!list.length) return res.status(200).json({ orders: [] });

    // Junta o status atual de cada pedido (recebido → cozinha → entrega → finalizado).
    const statusRef = db.ref(`/orderStatus/gestaoCompany_${companyId}_v1`);
    const out = await Promise.all(list.map(async (o) => {
      let status = "recebido";
      try { const s = await statusRef.child(String(o.id)).get(); if (s.exists() && s.val() && s.val().status) status = s.val().status; } catch (e) {}
      return {
        id: str(o.id, 60), nome: str(o.nome, 120), total: Number(o.total) || 0,
        tipoLabel: str(o.tipoLabel, 60), tipoEntrega: str(o.tipoEntrega, 20),
        itensCount: Number(o.itensCount) || 0, ts: Number(o.ts) || 0, status,
      };
    }));
    out.sort((a, b) => b.ts - a.ts);
    return res.status(200).json({ orders: out.slice(0, 50) });
  } catch (e) {
    return res.status(500).json({ error: "falha ao buscar pedidos", detail: String((e && e.message) || e) });
  }
};
