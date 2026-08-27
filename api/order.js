// /api/order — Envio de pedido do cardápio público NO SERVIDOR.
// Hoje o cliente (sem login) grava direto em /orders com token anônimo. Quando o
// login anônimo for desligado (fim da Fase 1/2), esse caminho morre — este endpoint
// assume: recebe { companyId, order }, valida a loja e grava via firebase-admin.
// Público por natureza (cliente não tem conta), mas: confere que a loja existe,
// limita o tamanho e normaliza os campos (nada de escrever fora de /orders).
const admin = require("firebase-admin");

// Aceita a conta de serviço como JSON puro OU base64 (qualquer das duas vars), tolerante.
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
  // CORS — o cardápio público roda em outro domínio (GitHub Pages) e chama este endpoint.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = await readJson(req);
    const companyId = str(body.companyId, 60).replace(/[^\w-]/g, "");
    const order = body.order || {};
    if (!companyId) return res.status(400).json({ error: "companyId ausente" });
    if (!order || !Array.isArray(order.itens) || order.itens.length === 0)
      return res.status(400).json({ error: "pedido vazio" });
    if (order.itens.length > 100) return res.status(413).json({ error: "pedido grande demais" });

    const app = initAdmin();
    const db = admin.database(app);
    // valida que a loja existe (evita gravar lixo p/ id inexistente)
    const master = (await db.ref("/data/gestaoMaster_v1/companies").get()).val() || [];
    const exists = Array.isArray(master) && master.some((c) => c && String(c.id) === companyId);
    if (!exists) return res.status(404).json({ error: "loja não encontrada" });

    // normaliza os campos que o admin do restaurante usa (checkPendingOrders)
    const clean = {
      id: str(order.id, 60) || db.ref().push().key,
      nome: str(order.nome, 120),
      tipo: str(order.tipo, 20),
      tipoLabel: str(order.tipoLabel, 60),
      referencia: str(order.referencia, 200),
      telefone: str(order.telefone, 20).replace(/\D/g, ""),
      total: Number(order.total) || 0,
      local: str(order.local, 60) || "Cardápio online",
      itens: order.itens.slice(0, 100).map((it) => ({
        id: str(it.id, 60), nome: str(it.nome, 120), preco: Number(it.preco) || 0,
        quantidade: Math.max(1, Math.min(99, Number(it.quantidade) || 1)),
        adicionais: Array.isArray(it.adicionais) ? it.adicionais.slice(0, 20).map((a) => ({ nome: str(a.nome, 80), preco: Number(a.preco) || 0 })) : [],
        observacao: str(it.observacao, 200),
      })),
      ts: Date.now(),
      createdAt: new Date().toISOString(),
    };
    await db.ref(`/orders/gestaoCompany_${companyId}_v1/${clean.id}`).set(clean);
    return res.status(200).json({ ok: true, orderId: clean.id });
  } catch (e) {
    return res.status(500).json({ error: "falha ao enviar pedido", detail: String((e && e.message) || e) });
  }
};
