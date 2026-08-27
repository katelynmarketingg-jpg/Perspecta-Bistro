// /api/payment-link — Gera um link de checkout REAL da InfinitePay para um
// pedido do cardápio público. Espelha o padrão do Perspecta Commerce
// (src/lib/payments/infinitepay.ts): o cliente paga Pix ou cartão no checkout
// hospedado da InfinitePay e o dinheiro cai na conta da loja.
//
// SEGURANÇA: o @handle (InfiniteTag) da loja é lido AQUI no servidor, a partir
// do nó público da própria loja (/public/gestaoCompany_<id>_v1). NUNCA aceitamos
// handle vindo do cliente — senão daria pra desviar o pagamento pra outra conta.
//
// Requer as env vars no projeto Vercel (as mesmas do /api/order e /api/login):
//   FIREBASE_SERVICE_ACCOUNT_B64  (ou FIREBASE_SERVICE_ACCOUNT)
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

// Chama a InfinitePay (checkout por handle — sem token secreto).
async function createInfinitePayLink({ handle, redirectUrl, orderId, items, customer, webhookUrl }) {
  const clean = String(handle || "").replace(/^@/, "").trim();
  if (!clean) return { error: "loja sem InfiniteTag configurada" };
  const payload = {
    handle: clean,
    redirect_url: redirectUrl,
    order_nsu: orderId || `bistro-${Date.now()}`,
    items: items.map((i) => ({ quantity: i.qty, price: i.priceCents, description: i.name })),
  };
  if (webhookUrl) payload.webhook_url = webhookUrl;
  if (customer && customer.name) {
    payload.customer = { name: customer.name, phone_number: customer.phone || "", email: customer.email || "" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: `InfinitePay HTTP ${res.status}` };
    const data = await res.json();
    if (!data || !data.url) return { error: "InfinitePay não devolveu link" };
    return { url: data.url };
  } catch (e) {
    return { error: "falha ao contatar a InfinitePay" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = await readJson(req);
    const companyId = str(body.companyId, 60).replace(/[^\w-]/g, "");
    const order = body.order || {};
    const redirectUrl = str(body.redirectUrl, 500) || "https://katelynmarketingg-jpg.github.io/Perspecta-Bistro/";
    if (!companyId) return res.status(400).json({ error: "companyId ausente" });
    if (!Array.isArray(order.itens) || order.itens.length === 0) return res.status(400).json({ error: "pedido vazio" });

    const app = initAdmin();
    const db = admin.database(app);
    // Handle lido do nó público da loja (fonte confiável) — nunca do cliente.
    const node = (await db.ref(`/public/gestaoCompany_${companyId}_v1/settings/pay/infinitepay`).get()).val() || {};
    const handle = node.handle;
    if (!handle || node.ativo === false) {
      return res.status(400).json({ error: "pagamento online não configurado para esta loja" });
    }

    const items = order.itens.slice(0, 100).map((it) => {
      const addPrice = Array.isArray(it.adicionais) ? it.adicionais.reduce((s, a) => s + (Number(a.preco) || 0), 0) : 0;
      const unit = (Number(it.preco) || 0) + addPrice;
      return { name: str(it.nome, 120) || "Item", priceCents: Math.max(0, Math.round(unit * 100)), qty: Math.max(1, Math.min(99, Number(it.quantidade) || 1)) };
    });
    const customer = {
      name: str(order.nome, 120) || "Cliente",
      phone: str(order.telefone, 20).replace(/\D/g, ""),
    };
    const orderId = str(order.id, 60) || `bistro-${Date.now()}`;

    const r = await createInfinitePayLink({ handle, redirectUrl, orderId, items, customer });
    if (r.url) return res.status(200).json({ url: r.url, orderId });
    return res.status(502).json({ error: r.error || "não foi possível gerar o link" });
  } catch (e) {
    return res.status(500).json({ error: "falha ao gerar pagamento", detail: String((e && e.message) || e) });
  }
};
