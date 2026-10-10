/* Petit Docteur : service worker. Rend l'app installable et garde l'écran de base hors ligne.
   Les appels /api ne sont jamais mis en cache (données de santé, sessions, paiements). */
var CACHE = "pd-v2";
var SHELL = ["/", "/static/app.js", "/static/style.css", "/icon-192.png"];
function keep(r, res) { if (res && res.ok) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); } return res; }
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.indexOf("/api/") === 0 || u.pathname === "/admin") return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(function (res) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put("/", cp); }); return res; })
      .catch(function () { return caches.match("/").then(function (m) { return m || new Response("Hors ligne. Reconnectez-vous à Internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }); }));
    return;
  }
  // code et styles : réseau d'abord (les mises à jour s'appliquent tout de suite), cache en secours hors ligne
  if (u.pathname.indexOf("/static/") === 0) {
    e.respondWith(fetch(r).then(function (res) { return keep(r, res); }).catch(function () { return caches.match(r); }));
    return;
  }
  if (/\.(png|webmanifest)$/.test(u.pathname)) {
    e.respondWith(caches.match(r).then(function (m) {
      var net = fetch(r).then(function (res) { return keep(r, res); }).catch(function () { return m; });
      return m || net;
    }));
  }
});
