# PREP (não publicado) — Medição de uso por loja (MB, atividade)

**Status:** pronto para aplicar, **NÃO aplicado / NÃO publicado**. Item de custo/escala, sem urgência.
**Objetivo:** saber, por loja, **quanto ocupa** no Firebase (MB de dados + MB de fotos) e uma noção de atividade, para o painel central mostrar custo e, no futuro, aplicar planos/cotas.

## Decisão de arquitetura (importante p/ o concern B)
Fazer a medição **no Perspecta Central**, não no Bistro.
- O Central **já lê o RTDB inteiro** via service account (`lib/integrations/firebase.ts` → `readRoot`).
- Assim **não mexo no formato de dados do Bistro** (nada de novo nó `/usage` gravado pelo app), então **zero risco** para o cliente Aliança e para a leitura do Central.
- Medir tamanho = medir o JSON de cada nó da loja. Dá pra fazer 100% na leitura.

> ⚠️ **Limite honesto:** o RTDB **não expõe contagem de leituras/banda por caminho**. "Leituras/GB baixado" reais são **nível de projeto** e vêm da aba **Uso** do console (ou da Cloud Monitoring API). Por loja, dá pra medir **tamanho ocupado** (o que mais importa pro plano free de 1 GB) com precisão; "leituras por loja" só dá pra **estimar** (nº de itens, atividade recente).

## Onde ficaria (Central) — depende do repo Perspecta--Central
Adicionar em `lib/integrations/firebase.ts` (o `readRoot` já existe e é cacheado 60s):

```ts
// Tamanho aproximado, em bytes, de um valor do RTDB (JSON serializado ~ o que ocupa).
function approxBytes(v: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(v) ?? "", "utf8"); } catch { return 0; }
}

// Uso por loja: junta o nó de dados da empresa (gestaoCompany_<id>_v1),
// as fotos (/photos/<mesma-chave>) e os pedidos (/orders/<mesma-chave>).
export type UsoLoja = {
  loja: string;          // chave do nó (ex.: gestaoCompany_abc123_v1)
  dataBytes: number;     // tamanho do estado da loja
  fotoBytes: number;     // tamanho das fotos (base64 hoje; ~0 quando migrar p/ Storage)
  pedidosBytes: number;  // pedidos pendentes
  totalBytes: number;
  itensCardapio: number;
  atualizadoEm: number | null; // savedAt do estado, se houver
};

export async function getUsoPorLoja(): Promise<UsoLoja[] | null> {
  const root = await readRoot();
  if (!root || typeof root !== "object") return root === null ? null : [];
  const data = (root as any).data || {};
  const photos = (root as any).photos || {};
  const orders = (root as any).orders || {};
  const out: UsoLoja[] = [];
  for (const [key, val] of Object.entries<any>(data)) {
    if (!key.startsWith("gestaoCompany_")) continue;      // só nós de loja (ignora master, slug__*)
    const dataBytes = approxBytes(val);
    const fotoBytes = approxBytes(photos[key]);
    const pedidosBytes = approxBytes(orders[key]);
    out.push({
      loja: key,
      dataBytes, fotoBytes, pedidosBytes,
      totalBytes: dataBytes + fotoBytes + pedidosBytes,
      itensCardapio: Array.isArray(val?.menu) ? val.menu.length : 0,
      atualizadoEm: typeof val?.savedAt === "number" ? val.savedAt : null,
    });
  }
  // maior ocupação primeiro
  return out.sort((a, b) => b.totalBytes - a.totalBytes);
}

// Total do projeto (bate com o "quanto falta pro 1 GB" do plano free).
export async function getUsoProjeto(): Promise<{ totalBytes: number; lojas: number } | null> {
  const lojas = await getUsoPorLoja();
  if (lojas === null) return null;
  return { totalBytes: lojas.reduce((s, l) => s + l.totalBytes, 0), lojas: lojas.length };
}
```

Exibição (ex.: em `app/consumos/` ou `app/clientes/`): `MB = (totalBytes / 1048576).toFixed(1)`, com barra vs. 1024 MB (limite free). As fotos aparecem em `fotoBytes` — **quando migrarem pro Storage** (ver `PREP-fotos-storage.md`), esse número cai perto de zero e o custo de fotos passa a ser medido no **Storage** (aba Uso do Storage, nível de projeto).

## Se quiser também "leituras/atividade" por loja (aproximação)
Duas opções, ambas **aditivas e opcionais**:
- **A (Central, sem tocar no Bistro):** usar `atualizadoEm` (savedAt) + nº de comandas/vendas do dia como proxy de atividade. Zero risco.
- **B (Bistro grava um contador):** incrementar `/usage/{loja}/writes` a cada `syncToServer`. É uma escrita a mais por save e **muda o formato** (novo nó `/usage`) — por causa do concern B, **só faria se necessário** e é retrocompatível (nó novo, ninguém depende dele). Recomendo **A**.

## O que dependeria de você
- Como o Central é outro repo (`Perspecta--Central`), aplicar isso é um commit **lá**. Hoje minha sessão tem só **leitura** desse repo — para eu commitar, você me autoriza a anexá-lo com escrita (ou eu te entrego o patch pronto pra você colar).
- Números de **banda/leitura reais** do projeto: print da aba **Realtime Database → Uso** (nível de projeto) — a única fonte verdadeira desses valores.

## Resumo
- Medição de **tamanho por loja**: 100% viável, só-leitura, no Central, sem risco. Código acima pronto.
- Medição de **leitura/banda**: nível de projeto (console/Monitoring); por loja é estimativa.
- **Nada disso é urgente** enquanto ninguém mediu o uso real — o primeiro passo é o print da aba Uso pra sabermos se o inchaço já é problema hoje.
