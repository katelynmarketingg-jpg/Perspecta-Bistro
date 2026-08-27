// /api/rulescheck?key=XYZ — Prova que as regras da Fase 2 pegaram, testando LEITURA
// do ponto de vista de cada perfil (anônimo / loja / gestor). Só checa PERMITIDO(200)
// vs NEGADO(401) — nunca retorna conteúdo do banco. Guardado por ADMIN_SCAN_KEY.
const admin = require("firebase-admin");

function loadServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw && b64) { const t = String(b64).trim(); raw = t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8"); }
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT ausente");
  try { return JSON.parse(raw); } catch (e) {}
  const s = raw.indexOf("{"); if (s < 0) throw new Error("sem JSON");
  let d = 0, q = false, e2 = false;
  for (let i = s; i < raw.length; i++) { const c = raw[i];
    if (e2) { e2 = false; continue; } if (c === "\\") { e2 = true; continue; }
    if (c === '"') { q = !q; continue; } if (q) continue;
    if (c === "{") d++; else if (c === "}") { if (--d === 0) return JSON.parse(raw.slice(s, i + 1)); } }
  throw new Error("JSON incompleto");
}
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const sa = loadServiceAccount();
  return admin.initializeApp({ credential: admin.credential.cert(sa),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com` });
}
const DBURL = () => process.env.FIREBASE_DATABASE_URL || "https://perspecta-bistro-default-rtdb.firebaseio.com";
const WEBKEY = () => process.env.FIREBASE_WEB_API_KEY || "AIzaSyBy_FMQjmTMnR9OZC6wIQGVx1i2R_5DvAw";

async function anonToken() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEBKEY()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) });
  return (await r.json()).idToken;
}
async function claimToken(app, claims) {
  const ct = await admin.auth(app).createCustomToken("rc_" + (claims.role || "x"), claims);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEBKEY()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  return (await r.json()).idToken;
}
// tenta ler um caminho com um token; devolve "PERMITIDO"/"NEGADO"
async function tryRead(path, token) {
  const u = `${DBURL()}/${path}.json?shallow=true` + (token ? `&auth=${token}` : "");
  const r = await fetch(u);
  return r.status === 200 ? "PERMITIDO" : "NEGADO";
}

module.exports = async (req, res) => {
  if (!process.env.ADMIN_SCAN_KEY || req.query.key !== process.env.ADMIN_SCAN_KEY)
    return res.status(403).json({ error: "proibido" });
  try {
    const app = initAdmin();
    const anon = await anonToken();
    const gestor = await claimToken(app, { role: "gestor", storeId: "master" });
    const lojaZZZ = await claimToken(app, { role: "company", storeId: "ZZZ" }); // loja fictícia
    const tabela = [
      { alvo: "/public",                 anonimo: await tryRead("public", anon),                        lojaZZZ: await tryRead("public", lojaZZZ),                        gestor: await tryRead("public", gestor) },
      { alvo: "/data/gestaoMaster_v1",   anonimo: await tryRead("data/gestaoMaster_v1", anon),          lojaZZZ: await tryRead("data/gestaoMaster_v1", lojaZZZ),          gestor: await tryRead("data/gestaoMaster_v1", gestor) },
      { alvo: "/data/gestaoCompany_ZZZ_v1", anonimo: await tryRead("data/gestaoCompany_ZZZ_v1", anon),  lojaZZZ: await tryRead("data/gestaoCompany_ZZZ_v1", lojaZZZ),     gestor: await tryRead("data/gestaoCompany_ZZZ_v1", gestor) },
    ];
    const esperado = {
      "/public": "todos PERMITIDO",
      "/data/gestaoMaster_v1": "só gestor PERMITIDO",
      "/data/gestaoCompany_ZZZ_v1": "loja dona e gestor PERMITIDO; anônimo NEGADO",
    };
    return res.status(200).json({ ok: true, tabela, esperado });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
