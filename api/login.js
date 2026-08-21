// /api/login — Login validado NO SERVIDOR (Vercel Function, runtime Node).
// Recebe { empresa, nome, senha }, confere contra o RTDB via firebase-admin
// (que ignora as regras) e devolve um CUSTOM TOKEN do Firebase com claims
// { role, storeId }. O navegador nunca mais lê credencial nem o nó master.
//
// Reaproveita o padrão do Perspecta Central (firebase-admin em função Vercel)
// e o de identidade determinística do Commerce (aqui o uid é o company.id,
// estável e sem tabela de mapeamento).
//
// Requer as env vars no projeto Vercel (Production + Preview):
//   FIREBASE_SERVICE_ACCOUNT_B64  (JSON da conta de serviço em base64)   [ou FIREBASE_SERVICE_ACCOUNT]
//   FIREBASE_DATABASE_URL         (opcional; derivado do project_id)
const admin = require("firebase-admin");
const crypto = require("crypto");

// Aceita a conta de serviço como JSON puro OU base64, em qualquer das duas vars,
// e tolera lixo/sobra ao redor (extrai o 1º objeto JSON balanceado).
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

// Lê o corpo JSON de forma robusta: usa req.body se a Vercel já parseou;
// senão lê o stream (evita login falhar por corpo não-parseado).
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

const norm = (s) => String(s || "").trim().toLowerCase();

// Mesmo esquema do cliente (index.html): passHash = "salt$hexSHA256(salt + ':' + senha)".
function verifyPassHash(senha, passHash) {
  if (typeof passHash !== "string" || passHash.indexOf("$") < 0) return false;
  const i = passHash.indexOf("$");
  const salt = passHash.slice(0, i), hash = passHash.slice(i + 1);
  const calc = crypto.createHash("sha256").update(salt + ":" + String(senha == null ? "" : senha)).digest("hex");
  if (calc.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
}
// Retrocompat: conta ainda com senha em texto (não migrada) casa por igualdade.
function credOk(senha, cred) {
  if (!cred) return false;
  if (cred.passHash) return verifyPassHash(senha, cred.passHash);
  if (cred.senha != null) return String(senha) === String(cred.senha);
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = await readJson(req);
    const { empresa, nome, senha } = body;
    const app = initAdmin();
    const db = admin.database(app);
    const master = (await db.ref("/data/gestaoMaster_v1").get()).val() || {};
    const emp = norm(empresa), pes = norm(nome);

    // ── Gestor ──
    const gc = master.gestorCredentials || {};
    if ((emp === norm(gc.login) || pes === norm(gc.login)) && credOk(senha, gc)) {
      const token = await admin.auth(app).createCustomToken("gestor", { role: "gestor", storeId: "master" });
      return res.status(200).json({ token, role: "gestor" });
    }
    // ── Empresa ──
    for (const c of (master.companies || [])) {
      if (!c || c.status === "inativo") continue;
      const nomeOk = norm(c.nome) === emp;
      const pessoaOk = !c.responsavel || norm(c.responsavel) === pes;
      const loginAntigo = c.login && (norm(c.login) === emp || norm(c.login) === pes);
      if (((nomeOk && pessoaOk) || loginAntigo) && credOk(senha, c)) {
        const uid = String(c.id);
        const token = await admin.auth(app).createCustomToken(uid, { role: "company", storeId: uid });
        return res.status(200).json({ token, role: "company", company: { id: c.id, nome: c.nome, login: c.login || null } });
      }
    }
    return res.status(401).json({ error: "Empresa, nome ou senha incorretos" });
  } catch (e) {
    return res.status(500).json({ error: "falha no login", detail: String((e && e.message) || e) });
  }
};
