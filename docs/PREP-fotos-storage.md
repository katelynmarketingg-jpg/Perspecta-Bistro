# PREP (não publicado) — Fotos: base64 no RTDB → Firebase Storage

**Status:** pronto para aplicar, **NÃO aplicado / NÃO publicado**. Item de custo/escala, sem urgência.
**Motivo:** hoje cada foto é gravada como **base64 dentro do Realtime Database** (`/photos/{loja}/{item} = {b64, tag}` — ver `index.html:2676`). Base64 incha o RTDB (~+33% sobre o tamanho do arquivo) e o plano free do RTDB é só ~1 GB. O **Storage** é feito pra arquivo (5 GB free) e serve por URL/CDN.

> ⚠️ **Antes de aplicar, lembrar do concern B:** o Perspecta Central lê o RTDB de forma **genérica e só-leitura** (via service account). Esta mudança é **retrocompatível e aditiva** (novos registros passam a ter `{url}`; os antigos `{b64}` continuam sendo lidos), então **não quebra o Central nem o cliente Aliança**. Central segue exibindo o nó `/photos` normalmente.

## O que muda no dado
- **Hoje:** `/photos/{loja}/{item}` = `{ b64: "data:image/...", tag }`
- **Depois:** `/photos/{loja}/{item}` = `{ url: "https://firebasestorage.../o/photos%2F...", tag }`
- Bytes da imagem passam a viver no **Storage**, não no RTDB.

## Passos que dependem de você (Console) — ~3 min
1. **console.firebase.google.com → projeto perspecta-bistro → Storage → Começar** (habilita o bucket; escolha o modo de produção).
2. **Storage → Regras** e cole:
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /photos/{loja}/{arquivo=**} {
         allow read: if true;                 // fotos do cardápio são públicas
         allow write: if request.auth != null; // só o app autenticado (anônimo) grava
       }
     }
   }
   ```
3. Me diga o **nome do bucket** (aparece no topo da tela do Storage, algo como `perspecta-bistro.appspot.com` ou `perspecta-bistro.firebasestorage.app`).

## Código drop-in (index.html) — aplico quando você mandar
Depende do bucket do passo 3. A constante entra perto de `FIREBASE_URL`:

```js
const FIREBASE_BUCKET = "perspecta-bistro.appspot.com"; // <-- do passo 3

// Converte data:URL em bytes e sobe pro Storage; devolve a URL pública de download.
async function uploadPhotoToStorage(path, dataUrl) {
  const token = await ensureFbToken();
  const blob = await (await fetch(dataUrl)).blob();               // data:URL -> Blob
  const url = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: blob
  });
  if (!r.ok) throw new Error("upload falhou " + r.status);
  const meta = await r.json();
  const tokenDl = meta.downloadTokens ? "&token=" + meta.downloadTokens : "";
  return `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/${encodeURIComponent(path)}?alt=media${tokenDl}`;
}
```

**`setItemPhoto`** (hoje em `index.html:2689`) passa a subir pro Storage e guardar `{url}` em vez de `{b64}`:
```js
async function setItemPhoto(item, b64) {
  const tag = newPhotoTag();
  photoMem[item.id] = b64; _photoTagMem[item.id] = tag;   // mostra na hora (base64 local)
  await idbSet(photoStoreKey(item.id), { b64, tag });     // cache local segue base64 (rápido)
  item.photoUpload = true; item.photoTag = tag; item.foto = null;
  try {
    const path = `photos/${fbPath(storeKey)}/${item.id}`;
    const url = await uploadPhotoToStorage(path, b64);
    photoMem[item.id] = url;                              // troca o cache pra URL
    await authedFetch(`${FIREBASE_URL}/photos/${fbPath(storeKey)}/${item.id}.json`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, tag })
    });
  } catch (e) {
    syncPhotoToServer(item.id, b64, tag);                 // fallback: mantém base64 (comportamento atual)
  }
}
```

**`hydratePhotos`** (hoje `index.html:2657`) — aceitar `{url}` (novo) **ou** `{b64}` (legado):
```js
const data = await r.json();
const src = data && (data.url || data.b64 || (typeof data === 'string' ? data : null)); // url vence
if (!src) continue;
photoMem[item.id] = src; _photoTagMem[item.id] = (data && data.tag) || item.photoTag || '';
// (idbSet e atualização do <img> seguem iguais — src pode ser URL ou data:base64)
```

`resolvePhoto` (2698) já funciona: devolve `photoMem[item.id]`, que agora pode ser URL **ou** base64 — os dois valem como `src` de `<img>`. Nada mais muda.

## Migração dos que já existem (opcional, roda 1x)
Função one-shot: para cada `item.photoUpload`, lê o `{b64}` legado, sobe pro Storage, regrava `{url}` e apaga o base64 do RTDB. Rodar só depois de validar uploads novos. (Código pronto no momento de aplicar — depende do bucket.)

## Compatibilidade e rollback
- **Retrocompatível:** código novo lê `{url}` e `{b64}`. Registros e caches antigos seguem funcionando.
- **GitHub Pages antigo:** se ainda servir o código velho, ele grava `{b64}` — o código novo lê isso sem problema. (Ver `PREP` do concern A: consolidar no link da Vercel.)
- **Central:** só-leitura e genérico → não afetado.
- **Rollback:** reverter o código; nada no Storage precisa ser apagado; os `{b64}` legados continuam válidos.

## Ganho esperado
Tira o maior fator de inchaço do RTDB. O quanto vale só dá pra afirmar **medindo o uso real** (ver `PREP-medicao-uso.md`) — hoje ninguém mediu ainda.
