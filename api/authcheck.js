// /api/authcheck?key=XYZ — Verifica se a conta de serviço consegue EMITIR custom
// token com claims (base do login no servidor e das regras da Fase 2). Não emite
// nada real: cria um token de teste e só reporta ok/erro. Guardado por ADMIN_SCAN_KEY.
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

module.exports = async (req, res) => {
  if (!process.env.ADMIN_SCAN_KEY || req.query.key !== process.env.ADMIN_SCAN_KEY)
    return res.status(403).json({ error: "proibido" });
  try {
    const app = initAdmin();
    const token = await admin.auth(app).createCustomToken("authcheck", { role: "test", storeId: "test" });
    return res.status(200).json({ ok: true, tokenLen: (token || "").length, msg: "createCustomToken OK — claims viáveis; Fase 2 pode contar com role/storeId" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e), dica: "conta de serviço precisa da permissão de criar token (iam signBlob / Service Account Token Creator)" });
  }
};
