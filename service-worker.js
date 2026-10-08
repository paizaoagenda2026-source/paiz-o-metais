/* =========================================================
   SERVICE WORKER · PAIZÃO METAIS
   Versão: v1.0.0
   Estratégias:
   - Navegação (HTML): Network First com fallback em cache
   - Recursos locais: Cache First com atualização em background
   - Recursos externos (CDN, Drive, APIs): Stale-While-Revalidate
   ========================================================= */

'use strict';

const CACHE_VERSION   = 'paizao-v1.0.0';
const CACHE_STATIC    = CACHE_VERSION + '-static';
const CACHE_DYNAMIC   = CACHE_VERSION + '-dynamic';
const CACHE_EXTERNAL  = CACHE_VERSION + '-external';

/* Arquivos essenciais que serão pré-cacheados na instalação.
   Se algum não existir, ele é simplesmente ignorado (não quebra o SW). */
const PRECACHE_URLS = [
  './',
  './index.html',
  './logo.png',
  './manifest.json'
];

/* =========================================================
   INSTALL — Pré-cache dos arquivos essenciais
   ========================================================= */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        // addAll falha inteiro se um único item falhar.
        // Por isso adicionamos um por um, tolerando erros.
        return Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' }))
              .catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* =========================================================
   ACTIVATE — Limpa caches antigos e assume controle
   ========================================================= */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const validos = [CACHE_STATIC, CACHE_DYNAMIC, CACHE_EXTERNAL];
        return Promise.all(
          keys
            .filter((k) => !validos.includes(k))
            .map((k) => caches.delete(k))
        );
      })
      .then(() => self.clients.claim())
  );
});

/* =========================================================
   FETCH — Roteamento por tipo de recurso
   ========================================================= */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignora métodos que não são GET
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Só processa http(s)
  if (!url.protocol.startsWith('http')) return;

  // Ignora requisições de extensões do navegador
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') return;

  // ---------- 1) NAVEGAÇÃO (HTML) ----------
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // ---------- 2) MESMO DOMÍNIO ----------
  if (url.origin === self.location.origin) {
    event.respondWith(handleLocal(req));
    return;
  }

  // ---------- 3) EXTERNOS (CDN, Drive, APIs) ----------
  event.respondWith(handleExternal(req));
});

/* ---------------------------------------------------------
   Navegação: Network First → Cache → Fallback offline
   --------------------------------------------------------- */
function handleNavigate(req) {
  return fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_STATIC)
          .then((c) => c.put(req, copy))
          .catch(() => {});
      }
      return res;
    })
    .catch(() => {
      return caches.match(req)
        .then((r) => r || caches.match('./index.html'))
        .then((r) => r || caches.match('./'))
        .then((r) => r || offlineFallback());
    });
}

/* ---------------------------------------------------------
   Recurso local: Cache First + atualização em background
   --------------------------------------------------------- */
function handleLocal(req) {
  return caches.match(req).then((cached) => {
    const rede = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(CACHE_STATIC)
            .then((c) => c.put(req, copy))
            .catch(() => {});
        }
        return res;
      })
      .catch(() => null);

    // Se tiver em cache, devolve na hora (e atualiza em background)
    if (cached) return cached;
    // Senão, espera a rede
    return rede.then((r) => r || caches.match('./index.html').then(x => x || Response.error()));
  });
}

/* ---------------------------------------------------------
   Recurso externo: Stale-While-Revalidate
   --------------------------------------------------------- */
function handleExternal(req) {
  return caches.open(CACHE_EXTERNAL).then((cache) => {
    return cache.match(req).then((cached) => {
      const rede = fetch(req)
        .then((res) => {
          // Aceita também respostas opaque (cross-origin sem CORS)
          if (res && (res.status === 200 || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());

      return cached || rede;
    });
  });
}

/* ---------------------------------------------------------
   Página de fallback quando offline e sem cache
   --------------------------------------------------------- */
function offlineFallback() {
  const html =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline · Paizão Metais</title>' +
    '<style>body{margin:0;font-family:Inter,Arial,sans-serif;background:#0f2338;' +
    'color:#fff;display:grid;place-items:center;height:100vh;text-align:center;padding:20px}' +
    'h1{font-size:22px;margin:0 0 10px}p{opacity:.75;max-width:420px;line-height:1.5}' +
    '.box{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);' +
    'padding:28px 24px;border-radius:16px}</style></head><body><div class="box">' +
    '<h1>📶 Você está offline</h1>' +
    '<p>Não foi possível carregar o sistema. Reconecte-se à internet e tente novamente.</p>' +
    '</div></body></html>';

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* =========================================================
   MENSAGENS DO CLIENTE — permite forçar atualização
   ========================================================= */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;
  if (data === 'SKIP_WAITING' || data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'CLEAR_CACHES') {
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    );
  }
});

/* =========================================================
   NOTIFICAÇÕES DE SINCRONIZAÇÃO (opcional / futuro)
   ========================================================= */
self.addEventListener('sync', (event) => {
  if (event.tag === 'paizao-sync') {
    // Reservado para sincronizações futuras em background
  }
});
