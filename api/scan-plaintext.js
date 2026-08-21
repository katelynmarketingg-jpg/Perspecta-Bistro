// /api/scan-plaintext?key=XYZ — Auditoria: varre TODO o Realtime Database
// procurando qualquer campo de senha em TEXTO (não-hash) que tenha sobrado.
// Confirma por código (não por presunção) que a migração senha→hash terminou.
// Protegido por env ADMIN_SCAN_KEY (defina no Vercel; passe ?key= igual).
//
// Regra: um campo chamado "senha"/"password" cujo valor NÃO tenha o formato
// de hash "salt$hash" é considerado TEXTO PURO e reportado com o caminho.
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

const isHash = (v) => typeof v === "string" && /^[0-9a-f]{8,}\$[0-9a-f]{64}$/.test(v);
const SENHA_KEYS = /^(senha|password|pass|pwd)$/i;

function walk(node, path, hits) {
  if (node == null || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    const p = path + "/" + k;
    if (SENHA_KEYS.test(k) && v != null && typeof v !== "object" && !isHash(v)) {
      hits.push({ path: p, sample: String(v).slice(0, 2) + "***" }); // não vaza a senha inteira
    }
    if (v && typeof v === "object") walk(v, p, hits);
  }
}

module.exports = async (req, res) => {
  if (!process.env.ADMIN_SCAN_KEY || req.query.key !== process.env.ADMIN_SCAN_KEY)
    return res.status(403).json({ error: "proibido" });
  try {
    const app = initAdmin();
    const root = (await admin.database(app).ref("/").get()).val() || {};
    const hits = [];
    walk(root, "", hits);
    return res.status(200).json({
      ok: hits.length === 0,
      senhasEmTextoEncontradas: hits.length,
      caminhos: hits,
      veredito: hits.length === 0 ? "LIMPO — nenhuma senha em texto no banco" : "AINDA HÁ SENHA EM TEXTO (ver caminhos)",
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
