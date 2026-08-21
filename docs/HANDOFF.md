# HANDOFF — Endurecimento de segurança do Perspecta Bistro

Continue o trabalho. Leia tudo antes de agir. A ordem importa mais que a velocidade.
Há um cliente real (Aliança) trabalhando neste sistema.

## CONTEXTO
- Repo: katelynmarketingg-jpg/Perspecta-Bistro · branch: claude/bistro-conversation-1aj74v (veja `git log` para o último commit).
- App: um único index.html (estático) + funções Vercel em /api. Banco: Firebase Realtime
  Database, projeto "perspecta-bistro". Hospedagem: Vercel (perspecta-bistro.vercel.app,
  produção = main) + GitHub Pages (idêntico).
- Perspecta Central (repo Perspecta--Central) lê ESTE RTDB só-leitura via service account.
  Cliente real "Aliança", company id "seejo3vuuympmzzi6h". Não quebre o layout que o Central lê.
- Do ambiente do agente o egress a *.firebaseio.com e github.io é BLOQUEADO. Teste via preview
  Vercel + web_fetch (só GET). POST e Console do Firebase dependem do usuário.

## JÁ FEITO (na branch, NADA em produção — produção segue em d61b870)
1. Senhas em hash SHA-256+salt (cliente e servidor); gestor não mostra senha (botão Redefinir).
2. Cardápio público lê nó enxuto /public/{loja} (provado campo a campo).
3. Índice do link amigável em /public/slug__ (retrocompatível com /data/slug__).
4. Login no servidor: api/login.js (custom token com claims {role, storeId}); cliente serverLogin()
   com fallback ao fluxo local; leitura de corpo robusta (readJson).
5. api/order.js (pedido público via servidor). api/scan-plaintext.js (auditoria).
   api/cleanup-plaintext.js (remove gestorCredentials morto). syncToServer não grava
   gestorCredentials em nó de loja.
6. api/nfce.js (Fase 3.4 intermediário): emite NFC-e no servidor lendo o token via admin; cliente
   religado (emitirNFCe) prefere /api/nfce com fallback direto (Plugnotas deduplica por idIntegracao).
   FICA DESCOBERTO: token ainda em /data/gestaoCompany_*/settings/nfceToken e o fallback usa token
   local. Fix completo: nó secreto + endpoint de gravação + remover fallback.
7. package.json (firebase-admin). Env vars Vercel: FIREBASE_SERVICE_ACCOUNT_B64 (aceita JSON ou
   base64) e ADMIN_SCAN_KEY (estava "001" = FRACA; trocar).
8. Regras de 3 níveis ESCRITAS em docs/PREP-fase2-rules.md (NÃO publicadas).
9. Fotos→Storage e medição de uso: documentados (docs/PREP-fotos-storage.md, docs/PREP-medicao-uso.md).
Preview: https://perspecta-bistro-git-cl-3503b0-katelynmarketingg-5736s-projects.vercel.app

## PROVAS OBTIDAS
- Scanner no preview: HTTP 200 → conta de serviço funciona e firebase-admin lê o banco.
- Auditoria: master real /data/gestaoMaster_v1 SEM senha em texto (credenciais reais já em hash).
  2 resíduos MORTOS restantes: /data/gestaoCompany_seejo..._v1/gestorCredentials/senha e nó __TESTE.
  Fix da raiz + cleanup prontos; rodar cleanup SÓ após o fix estar em produção.
- Funções vivas no preview: GET /api/login → 405; GET /api/scan-plaintext → 403 (sem chave).

## RESTRIÇÕES INVIOLÁVEIS
- NADA vai a produção fora da janela (15h–17h). Tenha rollback pronto.
- NÃO publique regra de banco sem aprovação: mostre a regra, o que libera/bloqueia, espere "ok".
- NÃO desligue o login anônimo sem Fase 1 no ar+testada, Fase 2 no ar e pedido público OK sem anônimo.
- Evidência sempre (saída de comando, HTTP status, tabela do Playground). Commit por item.

## O QUE FALTA, EM ORDEM
- FASE 1 fechar: (a) usuário testa login no preview (gestor + Aliança); (b) usuário troca
  ADMIN_SCAN_KEY e confirma senhas longas de gestor/Aliança; (c) na janela: merge para main,
  confirmar deploy, GET /api/cleanup-plaintext?key=... e depois /api/scan-plaintext?key=... → 0 resíduos.
- FASE 2 (só após Fase 1 no ar): publicar docs/PREP-fase2-rules.md COM aprovação; entregar a
  TABELA das 9 combinações do Rules Playground.
- FASE 3: nfce completo (nó secreto p/ o token); fotos→Storage (usuário habilita Storage + bucket);
  medição de uso (no Central, só-leitura).
- FINAL: desligar login anônimo (Firebase Console → Authentication → Sign-in method → Anônimo → Desativar).

## COMO TRABALHAR
Resolva sozinho; pare só para publicar regra, para o momento de desligar o anônimo, e se algo puder
derrubar o restaurante. Construa na branch, dispare preview, teste via web_fetch (GET), peça ao
usuário os testes de POST/Console. Ao fim de cada fase devolva o relatório STATUS BISTRO com tabela
(# | Item | Estado FEITO/EM ANDAMENTO/NÃO COMECEI/BLOQUEADO/NÃO SE APLICA | Evidência | Observação),
+ TABELA DO PLAYGROUND na Fase 2, + DEPENDE DE MIM (numerado, onde clicar), + PRÓXIMO ITEM.
Sem afirmação sem evidência; se não souber, escreva NÃO SEI.
