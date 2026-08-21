# PREP — Fase 2: regras de três níveis (NÃO publicar sem aprovação)

Só valem **depois** da Fase 1 no ar, porque dependem das claims `role`/`storeId` que o
`api/login` coloca no token. Sem as claims, estas regras trancam todo mundo.
As chaves do RTDB são planas: `gestaoMaster_v1`, `gestaoCompany_<id>_v1`. As regras casam a
loja por concatenação: `'gestaoCompany_' + auth.token.storeId + '_v1'`.

> Pré-requisito de escopo (ver RUNBOOK): mover o índice de slug para `/public/slug__<slug>` e
> tratar o envio de pedido (`api/order` ou regra pública só-criação) **antes** de aplicar isto,
> senão o cardápio público para.

## Regras propostas
```json
{
  "rules": {
    "public": { ".read": true, ".write": "auth != null" },
    "photos": {
      "$key": {
        ".read": true,
        ".write": "auth != null && (auth.token.role === 'gestor' || $key === 'gestaoCompany_' + auth.token.storeId + '_v1')"
      }
    },
    "orders": {
      "$key": {
        ".read": "auth != null && (auth.token.role === 'gestor' || $key === 'gestaoCompany_' + auth.token.storeId + '_v1')",
        ".write": "auth != null"
      }
    },
    "data": {
      "$key": {
        ".read":  "auth != null && (auth.token.role === 'gestor' || $key === 'gestaoCompany_' + auth.token.storeId + '_v1')",
        ".write": "auth != null && (auth.token.role === 'gestor' || $key === 'gestaoCompany_' + auth.token.storeId + '_v1')"
      }
    }
  }
}
```
- **Cardápio público** (`/public`): leitura livre; escrita só autenticado (o dono publica).
- **Dados de loja** (`/data/gestaoCompany_<id>_v1`): só a própria loja (storeId casa) ou gestor.
- **Master** (`/data/gestaoMaster_v1`): só gestor (nenhuma loja tem `role gestor`; o `$key` de
  master não casa a fórmula da loja) → lojas ficam de fora.

## Tabela ESPERADA do Playground (a RODAR por você no Console após a Fase 1)
Simular **read** em três alvos × três identidades. (Ainda NÃO rodei: exige claims reais no
Console; segue o esperado pelas regras acima — a evidência real é o print das 9 no Console.)

| Alvo \ Identidade | sem marca (anônimo) | loja B (storeId=B) | loja A (storeId=A) | gestor |
|---|---|---|---|---|
| /public/A (cardápio) | PERMITIDO | PERMITIDO | PERMITIDO | PERMITIDO |
| /data/gestaoCompany_A | NEGADO | NEGADO | PERMITIDO | PERMITIDO |
| /data/gestaoMaster_v1 | NEGADO | NEGADO | NEGADO | PERMITIDO |

As 9 combinações pedidas = as duas linhas de baixo (loja/master) × (sem marca, loja errada,
loja certa) + a coluna gestor como controle. Isolamento loja-a-loja provado pela célula
"loja B → /data/gestaoCompany_A = NEGADO".

## Como testar (Console → Realtime Database → Regras → Playground)
Para cada célula: tipo=Leitura, caminho do alvo, "Autenticado" com custom claims
`{ "role": "...", "storeId": "..." }`. Anotar Permitido/Negado das 9 e me mandar o print.
