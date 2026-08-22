# RUNBOOK — Fase 1: login validado no servidor (NÃO publicado)

Construído na branch, **sem deploy em produção**. Nada testado contra o Firebase real ainda
(deste ambiente o egress a `*.firebaseio.com` é bloqueado). Prova de runtime só no preview com a
conta de serviço configurada — ver "Teste no preview".

## Peças já commitadas
- `api/login.js` — recebe {empresa,nome,senha}, confere no servidor (firebase-admin), devolve
  **custom token** com claims `{role, storeId}` (storeId = company.id; gestor = "master").
  Retrocompatível: aceita conta ainda em texto (não migrada).
- `api/scan-plaintext.js` — varre o banco e lista qualquer senha em TEXTO restante (Fase 3.7).
- `package.json` — dependência `firebase-admin` (sem build script; o site estático segue igual).

## ⚠️ DESCOBERTA DE ESCOPO (é maior do que "só o login")
Desligar o login anônimo **quebra o cardápio público**, que hoje depende dele:
1. **Envio de pedido** do cliente grava em `/orders` com token anônimo. Sem anônimo, o cliente
   (que não tem login) não consegue enviar. → Precisa de `api/order.js` (grava o pedido no
   servidor) **ou** uma regra pública só-de-criação em `/orders`.
2. **Resolução do link amigável** lê `/data/slug__<slug>`. Com a Fase 2 travando `/data`, o
   link público para de resolver. → Mover o índice para `/public/slug__<slug>` (leitura livre).
Ambos precisam entrar **antes** de desligar o anônimo, senão a Aliança perde o cardápio.
Estimativa extra: ~meio dia. Recomendo `api/order.js` (fecha o buraco de escrita pública de vez).

## O que depende de você — em ordem
1. **Criar a conta de serviço** (Firebase Console → ⚙️ Configurações do projeto → *Contas de
   serviço* → *Gerar nova chave privada* → baixa um JSON). Depois gere o base64:
   `base64 -w0 chave.json` (ou `openssl base64 -A -in chave.json`).
2. **Vercel → projeto perspecta-bistro → Settings → Environment Variables** (marque *Production*
   e *Preview*), crie:
   - `FIREBASE_SERVICE_ACCOUNT_B64` = (o base64 do passo 1)
   - `ADMIN_SCAN_KEY` = (uma senha longa qualquer, sua)
3. Me avise que fez — aí eu aplico o **patch do cliente** (abaixo), faço deploy de **preview** e
   testo `/api/login` e `/api/scan-plaintext` antes de qualquer coisa em produção.

## Patch do cliente (ainda NÃO aplicado — entra na janela)
Trocar o miolo de rede do `doLogin` (hoje lê o master no navegador) por uma chamada ao servidor.
Resumo do fluxo novo (o navegador nunca mais lê credencial):
```js
// 1) pede ao servidor
const r = await fetch("/api/login", { method:"POST", headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ empresa, pessoa, senha }) });
if (!r.ok) { /* mostra "dados incorretos" */ return; }
const { token, role, company } = await r.json();
// 2) troca o custom token por um idToken do Firebase (carrega as claims)
const s = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
  { method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token, returnSecureToken:true }) });
const d = await s.json();
_fbAuth = { idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + (+d.expiresIn)*1000 };
localStorage.setItem('perspectaFbAuth', JSON.stringify(_fbAuth));
// 3) sessão a partir do papel devolvido pelo servidor (não do master local)
currentSession = role === "gestor" ? { type:"gestor" } : { type:"company", company };
```
`ensureFbToken()` passa a renovar por refresh token (já faz isso) e para de criar usuário
anônimo. `authedFetch` já manda `?auth=idToken` — que agora carrega `role`/`storeId` para as
regras da Fase 2.

## Teste no preview (antes da janela, sem risco pra produção)
- Deploy da branch (preview) com as env vars em *Preview*.
- `POST /api/login` com uma conta de teste → espero `{ token, role }`.
- `GET /api/scan-plaintext?key=...` → espero `senhasEmTextoEncontradas: 0`.

## Desligar o login anônimo (só no fim, com você)
**Só depois** de: Fase 1 no ar e testada + Fase 2 (regras) no ar + pedido público funcionando
sem anônimo (item de escopo acima). Então:
- **Firebase Console → Authentication → Sign-in method → Anônimo → Desativar.**
- Me diga a hora exata; eu confirmo o app antes e depois. Se desligar antes disso, o app para.

## Volta atrás (rollback)
- Reverter o commit do patch do cliente (login volta ao fluxo atual) e **reativar o login
  anônimo** no Console. Como nada disso entra fora da janela, o caminho de volta é 1 revert + 1
  toggle.
