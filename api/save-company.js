// /api/save-company — Grava/atualiza uma EMPRESA no nó mestre da nuvem PELO
// SERVIDOR (firebase-admin), sem depender do token do navegador (que falhava e
// deixava a empresa só no localStorage do note — por isso o login não funcionava
// em outro aparelho/celular). Mesmo padrão do /api/order e /api/login.
//
//   POST { gestorLogin, gestorSenha, company, gestorCredentials? }
//     → autoriza pelo gestor (senha confere com a nuvem OU, se a nuvem ainda não
//       tem gestor, o padrão Perspecta/001) e faz UPSERT da empresa por id em
//       /data/gestaoMaster_v1/companies. Nunca grava senha em texto (só passHash).
const admin = require("firebase-admin");
const crypto = require("crypto");

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
const norm = (s) => String(s || "").trim().toLowerCase();

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

// Mesmo esquema do cliente: passHash = "salt$hexSHA256(salt + ':' + senha)".
function verifyPassHash(senha, passHash) {
  if (typeof passHash !== "string" || passHash.indexOf("$") < 0) return false;
  const i = passHash.indexOf("$");
  const salt = passHash.slice(0, i), hash = passHash.slice(i + 1);
  const calc = crypto.createHash("sha256").update(salt + ":" + String(senha == null ? "" : senha)).digest("hex");
  if (calc.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
}
function credOk(senha, cred) {
  if (!cred) return false;
  if (cred.passHash) return verifyPassHash(senha, cred.passHash);
  if (cred.senha != null) return String(senha) === String(cred.senha);
  return false;
}
const isHash = (v) => typeof v === "string" && v.indexOf("$") > 0;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const body = await readJson(req);
    const company = body.company || {};
    const gestorSenha = body.gestorSenha;
    const gestorLogin = body.gestorLogin;
    if (!company || typeof company !== "object" || (!company.nome && !company.login))
      return res.status(400).json({ error: "empresa ausente" });

    const app = initAdmin();
    const db = admin.database(app);
    const masterRef = db.ref("/data/gestaoMaster_v1");
    const master = (await masterRef.get()).val() || {};
    const gc = master.gestorCredentials;

    // Autorização: senha do gestor confere com a nuvem; se a nuvem ainda não tem
    // gestor cadastrado (primeira sincronização), aceita o padrão Perspecta/001.
    let authorized = false;
    if (gc && (gc.passHash || gc.senha != null)) {
      authorized = credOk(gestorSenha, gc);
    } else {
      authorized = norm(gestorLogin || "Perspecta") === "perspecta" && String(gestorSenha) === "001";
    }
    if (!authorized) return res.status(401).json({ error: "senha do gestor incorreta" });

    // Sanitiza a empresa — NUNCA grava senha em texto (só passHash).
    const clean = {
      id: str(company.id, 60) || db.ref().push().key,
      nome: str(company.nome, 120),
      login: str(company.login, 60),
      responsavel: str(company.responsavel, 120),
      whatsapp: str(company.whatsapp, 30),
      codigo: str(company.codigo, 60),
      status: company.status === "inativo" ? "inativo" : "ativo",
      updatedAt: Date.now(),
    };
    if (isHash(company.passHash)) clean.passHash = String(company.passHash);

    const companies = Array.isArray(master.companies) ? master.companies.slice() : [];
    const i = companies.findIndex((c) => c && String(c.id) === clean.id);
    if (i >= 0) {
      const prev = companies[i] || {};
      // Preserva o passHash anterior se este pedido não trouxe um novo.
      companies[i] = { ...prev, ...clean, passHash: clean.passHash || prev.passHash };
      if ("senha" in companies[i]) delete companies[i].senha; // garante: nada de texto
    } else {
      companies.push(clean);
    }

    const updates = { companies };
    // Semeia o gestor na nuvem se ainda não existir (pra o gestor entrar de qualquer aparelho).
    if ((!gc || (!gc.passHash && gc.senha == null)) && body.gestorCredentials && (body.gestorCredentials.passHash || body.gestorCredentials.senha != null)) {
      const g = body.gestorCredentials;
      updates.gestorCredentials = { login: str(g.login, 60) || "Perspecta", ...(isHash(g.passHash) ? { passHash: g.passHash } : {}) };
    }
    await masterRef.update(updates);

    return res.status(200).json({ ok: true, company: { id: clean.id, nome: clean.nome, login: clean.login } });
  } catch (e) {
    return res.status(500).json({ error: "falha ao salvar empresa", detail: String((e && e.message) || e) });
  }
};
