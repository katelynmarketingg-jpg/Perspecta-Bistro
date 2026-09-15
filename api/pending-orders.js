// /api/pending-orders — O ADMIN do restaurante busca os pedidos do cardápio
// PELO SERVIDOR (conta de serviço), sem depender do token/regra do Firebase do
// navegador. Foi o que quebrava a chegada dos pedidos quando o login anônimo /
// token do admin falhava. Mesmo padrão do /api/order (que grava pelo servidor).
//
//   GET  ?companyId=X            → { orders: { orderId: {…} } }  (pendentes em /orders)
//   POST { companyId, ids:[…] }  → apaga esses pedidos de /orders (após virar comanda)
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

// Trava de acesso por loja (Fase 2). DORMENTE por padrão: só passa a EXIGIR o
// token quando REQUIRE_STORE_AUTH=1 nas env vars. Assim o código já vai pronto e
// a trava é LIGADA na janela (depois da Fase 1 no ar e do cliente enviando o
// token no header Authorization). Flag desligada → retorna ok na hora, sem tocar
// no request: comportamento byte-a-byte idêntico ao de hoje.
async function checkStoreAuth(req, app, companyId) {
  if (process.env.REQUIRE_STORE_AUTH !== "1") return { ok: true };
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (!m) return { ok: false, code: 401, error: "autenticação necessária" };
  try {
    const dec = await admin.auth(app).verifyIdToken(m[1].trim());
    if (dec.role === "gestor") return { ok: true };
    if (dec.role === "company" && String(dec.storeId) === String(companyId)) return { ok: true };
    return { ok: false, code: 403, error: "sem permissão para esta loja" };
  } catch (e) {
    return { ok: false, code: 401, error: "token inválido ou expirado" };
  }
}

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const app = initAdmin();
    const db = admin.database(app);

    if (req.method === "GET") {
      let companyId = str(req.query.companyId || req.query.company, 60).replace(/[^\w-]/g, "");
      // Também aceita ?slug= (resolve pelo índice público) — robustez/diagnóstico.
      if (!companyId && req.query.slug) {
        const slug = str(req.query.slug, 80).replace(/[^\w-]/g, "");
        const mapped = (await db.ref(`/public/slug__${slug}`).get()).val();
        if (typeof mapped === "string") companyId = mapped.replace(/[^\w-]/g, "");
      }
      if (!companyId) return res.status(400).json({ error: "companyId ausente" });
      const auth = await checkStoreAuth(req, app, companyId);
      if (!auth.ok) return res.status(auth.code).json({ error: auth.error });
      const snap = await db.ref(`/orders/gestaoCompany_${companyId}_v1`).get();
      return res.status(200).json({ companyId, count: snap.exists() ? Object.keys(snap.val()).length : 0, orders: snap.exists() ? snap.val() : {} });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const companyId = str(body.companyId, 60).replace(/[^\w-]/g, "");
      const ids = Array.isArray(body.ids) ? body.ids.map((x) => str(x, 60).replace(/[^\w-]/g, "")).filter(Boolean).slice(0, 100) : [];
      if (!companyId || !ids.length) return res.status(400).json({ error: "companyId/ids ausentes" });
      const auth = await checkStoreAuth(req, app, companyId);
      if (!auth.ok) return res.status(auth.code).json({ error: auth.error });
      const updates = {};
      for (const id of ids) updates[id] = null; // apagar
      await db.ref(`/orders/gestaoCompany_${companyId}_v1`).update(updates);
      return res.status(200).json({ ok: true, removed: ids.length });
    }

    return res.status(405).json({ error: "método não permitido" });
  } catch (e) {
    return res.status(500).json({ error: "falha ao buscar pedidos", detail: String((e && e.message) || e) });
  }
};
