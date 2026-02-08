/**
 * RPYM Service Worker
 *
 * Estrategia:
 * - NETWORK-ONLY: APIs, /admin, JSON, datos dinámicos (NUNCA cachear)
 * - CACHE-FIRST: Solo assets 100% estáticos (CSS, JS, imágenes, fuentes)
 *
 * Los precios y datos del catálogo SIEMPRE vienen del servidor.
 */

const CACHE_NAME = 'rpym-static-v1';

// Assets estáticos que SÍ se pueden cachear
const STATIC_ASSETS = [
  '/favicon.svg',
  '/favicon.ico',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json',
  // Las imágenes de productos NO se cachean porque pueden cambiar
];

// Patrones que NUNCA deben cachearse (network-only)
const NEVER_CACHE_PATTERNS = [
  /\/api\//,                    // Todas las APIs
  /\/admin/,                    // Sección admin completa
  /\.json$/,                    // Cualquier JSON (excepto manifest)
  /manifest\.json$/,            // Aunque termina en .json, es estático - lo excluimos de esta regla
  /sheets\.googleapis\.com/,    // Google Sheets
  /graph\.facebook\.com/,       // Meta/WhatsApp API
  /wa\.me/,                     // WhatsApp links
  /api\.whatsapp\.com/,         // WhatsApp Business API
  /localhost/,                  // Desarrollo local
  /127\.0\.0\.1/,               // Desarrollo local
];

// Verificar si una URL nunca debe cachearse
function shouldNeverCache(url) {
  const urlString = url.toString();

  // Excepción: manifest.json SÍ puede cachearse
  if (urlString.endsWith('/manifest.json')) {
    return false;
  }

  return NEVER_CACHE_PATTERNS.some(pattern => pattern.test(urlString));
}

// Verificar si es un asset estático cacheable
function isStaticAsset(url) {
  const urlString = url.toString();
  const pathname = new URL(urlString).pathname;

  // Solo cachear extensiones específicas de assets estáticos
  const staticExtensions = ['.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.svg', '.png', '.ico'];
  const hasStaticExtension = staticExtensions.some(ext => pathname.endsWith(ext));

  // Verificar que no sea un asset dinámico
  if (!hasStaticExtension) return false;

  // No cachear assets de la carpeta _astro que podrían tener datos
  // Los archivos JS/CSS de Astro tienen hashes, así que son seguros
  // Pero NO cachear imágenes de productos (pueden cambiar precios en overlays)
  const isProductImage = pathname.includes('/jose-') ||
                         pathname.includes('/camaron') ||
                         pathname.includes('/delivery') ||
                         pathname.includes('/cerrado') ||
                         pathname.includes('/pesca') ||
                         pathname.includes('/cobranzas');

  if (isProductImage) return false;

  return true;
}

// Install: Pre-cachear assets estáticos esenciales
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-cacheando assets estáticos');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: Limpiar caches antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Eliminando cache antiguo:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Manejar requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar requests HTTP/HTTPS
  if (!request.url.startsWith('http')) {
    return;
  }

  // Solo manejar GET requests
  if (request.method !== 'GET') {
    return;
  }

  // NETWORK-ONLY: URLs que nunca deben cachearse
  if (shouldNeverCache(url)) {
    event.respondWith(
      fetch(request).catch(() => {
        // Si falla y es una página, mostrar página offline
        if (request.headers.get('accept')?.includes('text/html')) {
          return createOfflinePage();
        }
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // CACHE-FIRST: Solo para assets estáticos verificados
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then((networkResponse) => {
              // Solo cachear respuestas exitosas
              if (networkResponse.ok) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, responseToCache));
              }
              return networkResponse;
            });
        })
        .catch(() => new Response('Asset no disponible', { status: 503 }))
    );
    return;
  }

  // NETWORK-ONLY: Para todo lo demás (HTML, páginas, etc.)
  // Esto asegura que el contenido siempre sea fresco
  event.respondWith(
    fetch(request).catch(() => {
      if (request.headers.get('accept')?.includes('text/html')) {
        return createOfflinePage();
      }
      return new Response('Offline', { status: 503 });
    })
  );
});

// Crear página offline simple
function createOfflinePage() {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sin conexión - RPYM</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #0c4a6e;
      font-size: 24px;
      margin-bottom: 12px;
    }
    p {
      color: #64748b;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    button {
      background: #0ea5e9;
      color: white;
      border: none;
      padding: 12px 32px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #0284c7;
    }
    .logo {
      color: #0c4a6e;
      font-weight: 700;
      font-size: 20px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📶</div>
    <h1>Sin conexión</h1>
    <p>No hay conexión a internet. Verifica tu conexión y vuelve a intentarlo.</p>
    <button onclick="location.reload()">Reintentar</button>
    <div class="logo">RPYM</div>
  </div>
</body>
</html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Escuchar mensajes del cliente
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
