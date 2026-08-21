// /api/cleanup-plaintext?key=XYZ — remove o resíduo de senha em texto:
// o "gestorCredentials" morto que o defaultState deixava em cada nó de loja
// (e em nós de teste __TESTE). NÃO toca no master real (gestaoMaster_v1), que
// já está em hash. Rodar SÓ depois do fix do syncToServer estar em produção,
// senão o código antigo re-injeta o campo no próximo save da loja.
// Protegido por ADMIN_SCAN_KEY (use uma chave longa; "001" é fraca).
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
    const db = admin.database(app);
    const data = (await db.ref("/data").get()).val() || {};
    const removidos = [];
    for (const key of Object.keys(data)) {
      if (key === "gestaoMaster_v1") continue;                 // master real: mantém (hash)
      const node = data[key];
      if (node && typeof node === "object" && node.gestorCredentials != null) {
        await db.ref(`/data/${key}/gestorCredentials`).remove();
        removidos.push(`/data/${key}/gestorCredentials`);
      }
    }
    return res.status(200).json({ ok: true, total: removidos.length, removidos });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
