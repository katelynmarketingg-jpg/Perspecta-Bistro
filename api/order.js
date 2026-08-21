// /api/order — Envio de pedido do cardápio público NO SERVIDOR.
// Hoje o cliente (sem login) grava direto em /orders com token anônimo. Quando o
// login anônimo for desligado (fim da Fase 1/2), esse caminho morre — este endpoint
// assume: recebe { companyId, order }, valida a loja e grava via firebase-admin.
// Público por natureza (cliente não tem conta), mas: confere que a loja existe,
// limita o tamanho e normaliza os campos (nada de escrever fora de /orders).
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin.app();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8")
    : process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT ausente");
  const sa = JSON.parse(raw);
  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com`,
  });
}

const str = (v, max) => String(v == null ? "" : v).slice(0, max || 200);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
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
