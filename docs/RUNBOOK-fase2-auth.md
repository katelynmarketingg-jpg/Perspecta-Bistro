# RUNBOOK — Ligar a trava de acesso por loja (Fase 2 auth) + regras + anônimo

Objetivo: fechar os buracos CRÍTICO/ALTO de autenticação (`pending-orders`, `order-status`
POST, `nfce`) e publicar as regras da Fase 2, **sem derrubar o restaurante**.

Tudo que o código precisa **já está na branch** (dormente). Nesta janela você só liga a
chave e publica as regras. Faça na janela (15h–17h), com rollback pronto.

## Pré-requisitos (confirmar ANTES)
- [ ] Fase 1 no ar e testada: login pelo servidor (`/api/login`) funcionando para o
      **gestor** e para a **Aliança**, em mais de um aparelho. (Se cair no fallback local,
      o token é anônimo, sem claim `storeId`, e a trava barra o admin.)
- [ ] `ADMIN_SCAN_KEY` já trocada por um valor longo (não pode seguir "001").
- [ ] Deploy da branch em produção concluído (o cliente já envia `Authorization` — no-op
      enquanto a flag estiver desligada).

## Sequência (a ordem importa)

### 1) Provar que o admin manda o token (flag ainda DESLIGADA)
- No app do restaurante logado, abrir DevTools → Network → ver a chamada
  `GET /api/pending-orders`: deve ter header `Authorization: Bearer …`.
- Se NÃO tiver: o admin está no fallback local (anônimo). Resolver a Fase 1 antes de seguir.

### 2) Ligar a trava
- Vercel → Project → Settings → Environment Variables → **Production**:
  `REQUIRE_STORE_AUTH = 1`  → Redeploy.
- Teste imediato (com a Aliança logada):
  - [ ] Pedidos do cardápio continuam chegando (checkPendingOrders).
  - [ ] Publicação de status funciona (mudar uma comanda → cliente vê o status novo).
  - [ ] Emissão de NFC-e funciona.
- Teste de bloqueio (sem token): `curl "https://perspecta-bistro.vercel.app/api/pending-orders?companyId=<id>"`
  deve responder **401** (antes respondia 200 com os pedidos).
- **Rollback:** apagar `REQUIRE_STORE_AUTH` (ou setar `0`) + redeploy. Volta ao comportamento atual na hora.

### 3) Publicar as regras da Fase 2
- Console → Realtime Database → Regras → colar o JSON de `docs/PREP-fase2-rules.md` → Publicar.
- Rodar `GET /api/rulescheck?key=<ADMIN_SCAN_KEY>` e conferir a tabela (precisa de
  `FIREBASE_WEB_API_KEY` nas env vars). Esperado:

  | Alvo | anônimo | loja errada | loja certa | gestor |
  |---|---|---|---|---|
  | /public | PERMITIDO | PERMITIDO | PERMITIDO | PERMITIDO |
  | /data/gestaoCompany_A | NEGADO | NEGADO | PERMITIDO | PERMITIDO |
  | /data/gestaoMaster_v1 | NEGADO | NEGADO | NEGADO | PERMITIDO |

- **Rollback:** republicar as regras antigas (guardar o JSON atual de `database.rules.json` antes).

### 4) Desligar o login anônimo
- Só depois de 2) e 3) OK e do envio de pedido público provado (via `/api/order`, servidor).
- Console → Authentication → Sign-in method → Anônimo → Desativar.
- Teste: cliente novo (aba anônima) consegue ver o cardápio e **enviar um pedido**.
- **Rollback:** reativar o Anônimo.

## Depois da janela (limpeza)
- [ ] `nfceToken`: mover para nó secreto e remover o fallback direto do cliente
      (`index.html` ~6140) — com as regras da Fase 2, `/data` já não é legível por anônimo,
      então o vazamento principal está fechado; isto é o endurecimento final.
- [ ] Restringir a `FIREBASE_WEB_API_KEY` no Google Cloud Console (referrer/API restrictions).
- [ ] Rodar `GET /api/scan-plaintext?key=…` → 0 resíduos.

## O que cada peça faz (referência)
- `checkStoreAuth()` em `api/pending-orders.js`, `api/order-status.js`, `api/nfce.js`:
  exige `Authorization: Bearer <ID token>` e confere `role==='gestor'` ou
  `role==='company' && storeId===companyId`. Dormente até `REQUIRE_STORE_AUTH=1`.
- `adminAuthHeaders()` em `index.html`: anexa o token do admin nas 4 chamadas.
- Regras da Fase 2 (`docs/PREP-fase2-rules.md`): fecham a leitura direta de `/data` e
  `/orders` no Firebase por qualquer usuário (o que a trava dos endpoints não cobre).
