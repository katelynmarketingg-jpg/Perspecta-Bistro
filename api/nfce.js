// /api/nfce — Emissão de NFC-e NO SERVIDOR (intermediário da Fase 3.4).
// O navegador manda { companyId, payload } SEM o token; o servidor lê o token
// da loja no RTDB (via firebase-admin) e chama o Plugnotas com o x-api-key.
// Assim, no caminho principal, o token não trafega do navegador para o Plugnotas.
//
// O QUE AINDA FICA DESCOBERTO (intermediário): o token continua ARMAZENADO em
// /data/gestaoCompany_<id>_v1/settings/nfceToken (legível por quem lê o nó da loja)
// e o cliente mantém um FALLBACK direto que ainda usa o token local. Fix completo:
// mover o token para um nó secreto (regras negam leitura ao cliente) + endpoint de
// gravação + remover o fallback. Sem risco de nota dupla: o Plugnotas deduplica por
// idIntegracao (= command.id).
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
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = await readJson(req);
    const companyId = String(body.companyId || "").replace(/[^\w-]/g, "");
    const payload = body.payload;
    if (!companyId || !payload) return res.status(400).json({ error: "companyId/payload ausente" });

    const app = initAdmin();
    const settings = (await admin.database(app).ref(`/data/gestaoCompany_${companyId}_v1/settings`).get()).val() || {};
    const token = settings.nfceToken;
    if (!token) return res.status(400).json({ error: "loja sem token NFC-e configurado" });

    const r = await fetch("https://api.plugnotas.com.br/nfce", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text); // repassa o corpo do Plugnotas como veio
  } catch (e) {
    return res.status(500).json({ error: "falha na emissão", detail: String((e && e.message) || e) });
  }
};
