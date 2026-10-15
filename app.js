"use strict";
/* Petit Docteur : application (public, patients Premium, médecins et réseau de confrères). */
var $ = function (i) { return document.getElementById(i); };
var me = null, cfg = { cats: [], price: 15000, part_medecin: 7000, part_admin: 8000, currency: "CDF", days: 30, paiement: false, whatsapp: "" };
var fac = { specialites: [], villes: [], stats: {} };
var RL = { s: "Faible", p: "Prudence", u: "Urgence" };
var viewTimer = null, inboxTimer = null, shownCall = 0, fq = "", fcat = -1, searchTimer = null;
var unread = 0, pending = 0, ctab = "annuaire", curReload = null, autoCall = false;
var flt = { q: "", sp: "", vi: "", di: false };
var isDoctorPath = location.pathname === "/medecin";

// ---------- langues : français (base), anglais, lingala, swahili, kikongo, tshiluba ----------
var LANGS = [["fr", "Français"], ["en", "English"], ["ln", "Lingála"], ["sw", "Kiswahili"], ["kg", "Kikongo"], ["lua", "Tshiluba"]];
var DICT = window.I18N || {};
var lang = "fr";
try { lang = localStorage.getItem("pd_lang") || ""; } catch (e) { lang = ""; }
if (!DICT[lang] && lang !== "fr") {
  var nl = String(navigator.language || "fr").slice(0, 2).toLowerCase();
  lang = DICT[nl] ? nl : "fr";
}
function T(s) { var d = DICT[lang]; return (d && d[s]) || s; }
function t(s, v) { var r = T(s); if (v) for (var k in v) r = r.split("{" + k + "}").join(v[k]); return r; }
var ATTRS = ["placeholder", "aria-label", "title", "alt"];
function trNode(n) {
  if (n.nodeType === 3) {
    var p = n.parentNode;
    if (p && p.closest && p.closest('[translate="no"],script,style')) return;
    if (n.__o === undefined) { if (!/\S/.test(n.nodeValue)) return; n.__o = n.nodeValue; }
    var m = n.__o.match(/^(\s*)([\s\S]*?)(\s*)$/), d = DICT[lang], tr = lang !== "fr" && d && d[m[2].replace(/\s+/g, " ")];
    n.nodeValue = tr ? m[1] + tr + m[3] : n.__o;
  } else if (n.nodeType === 1) {
    if (n.closest && n.closest('[translate="no"]')) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = n.getAttribute(a);
      if (v === null) continue;
      n.__a = n.__a || {};
      if (n.__a[a] === undefined) n.__a[a] = v;
      var dd = DICT[lang]; n.setAttribute(a, (lang !== "fr" && dd && dd[n.__a[a]]) || n.__a[a]);
    }
    for (var c = n.firstChild; c; c = c.nextSibling) trNode(c);
  }
}
new MutationObserver(function (ms) { if (lang === "fr") return; ms.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) trNode(m.addedNodes[i]); }); }).observe(document.body, { childList: true, subtree: true });
window.alert = (function (a) { return function (m) { a.call(window, T(String(m))); }; })(window.alert);
function applyLang() {
  document.documentElement.lang = lang;
  document.title = T("Petit Docteur") === "Petit Docteur" ? document.title : T("Petit Docteur");
  if (lang !== "fr" || document.body.__tr) { trNode(document.body); document.body.__tr = true; }
  var sel = document.getElementById("lang"); if (sel) sel.value = lang;
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem("pd_lang", l); } catch (e) { /* stockage indisponible */ }
  applyLang(); route(); if (window.astRebuild) astRebuild();
  if (me && pushOn) syncPush();
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { return Number(n).toLocaleString("fr-FR").replace(/[\u202f\u00a0 ]/g, "\u00a0") + "\u00a0" + (cfg.currency === "CDF" ? "FC" : cfg.currency); }
function api(p, o) {
  o = o || {}; o.credentials = "same-origin";
  return fetch(p, o).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) { var e = new Error(T(d.detail || "Erreur " + r.status)); e.status = r.status; throw e; }
      return d;
    });
  });
}
function jsend(p, m, b) { return api(p, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }); }
function initials(n) { return String(n || "?").replace(/^dr\.?\s+/i, "").split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase(); }
function drName(n) { return /^dr\.?\s/i.test(n) ? n : "Dr " + n; }
function avatar(u, cls) {
  var img = u.has_photo ? '<img alt="" src="/api/users/' + u.id + '/photo" onerror="this.remove()">' : "";
  return '<span class="av ' + (cls || "") + " c" + ((u.id || 0) % 6) + '">' + esc(initials(u.nom)) + img + "</span>";
}
function msg(el, text, ok) { el.textContent = text ? T(text) : ""; el.className = ok ? "ok" : "err"; }
function stopTimers() { clearInterval(viewTimer); viewTimer = null; }
function isDoc() { return !!me && me.role === "medecin"; }
function isDocOk() { return isDoc() && me.statut === "approuve"; }

// ---------- icônes (traits simples, SVG intégré) ----------
var ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  usercheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  brief: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>'
};
function ic(n, cls) { return '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + "</svg>"; }
function tile(color, icon, label, href, o) {
  o = o || {};
  var inner = ic(icon) + "<span>" + label + (o.sub ? "<small>" + o.sub + "</small>" : "") + "</span>" + (o.badge ? '<span class="nbadge">' + o.badge + "</span>" : "");
  if (o.ext) return '<a class="tile t-' + color + '" target="_blank" rel="noopener" href="' + href + '">' + inner + "</a>";
  if (o.act) return '<button type="button" class="tile t-' + color + '" data-act="' + o.act + '">' + inner + "</button>";
  return '<a class="tile t-' + color + (o.off ? " off" : "") + '" href="' + href + '">' + inner + "</a>";
}

// ---------- WhatsApp : l'administrateur facilitateur aide pour l'achat des remèdes ----------
function waLink(text) { return "https://wa.me/" + esc(cfg.whatsapp) + "?text=" + encodeURIComponent(T(text)); }
function waButton(text, label, cls) {
  return cfg.whatsapp ? '<a class="btn ' + (cls || "") + '" target="_blank" rel="noopener" href="' + waLink(text) + '">' + ic("chat") + label + "</a>" : "";
}
function footer() {
  return '<p class="foot"><a href="/confidentialite">Confidentialité</a> · <a href="/conditions">Conditions d\'utilisation</a>' +
    (cfg.whatsapp ? ' · <a target="_blank" rel="noopener" href="' + waLink("Bonjour, j'ai besoin d'aide sur Petit Docteur.") + '">Aide sur WhatsApp</a>' : "") + "</p>";
}

// ---------- notifications (reçues même application fermée) ----------
var pushOn = false;
function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function b64(u) { var p = "=".repeat((4 - u.length % 4) % 4), r = atob((u + p).replace(/-/g, "+").replace(/_/g, "/")), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
function syncPush() {
  if (!pushSupported() || !me || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
    pushOn = !!sub;
    if (sub) return jsend("/api/push/subscribe", "POST", Object.assign(sub.toJSON(), { lang: lang }));
  }).catch(function () {});
}
function enablePush() {
  if (!pushSupported()) return Promise.reject(new Error(iosSafari && !standalone ? "Sur iPhone, installez d'abord l'application sur l'écran d'accueil, puis activez les notifications." : "Ce navigateur ne permet pas les notifications."));
  return Notification.requestPermission().then(function (perm) {
    if (perm !== "granted") throw new Error("Notifications refusées. Autorisez-les dans les réglages du navigateur.");
    return Promise.all([navigator.serviceWorker.ready, api("/api/push/key")]);
  }).then(function (r) {
    if (!r[1].key) throw new Error("Les notifications ne sont pas disponibles sur ce serveur.");
    return r[0].pushManager.getSubscription().then(function (sub) { return sub || r[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(r[1].key) }); });
  }).then(function (sub) { return jsend("/api/push/subscribe", "POST", Object.assign(sub.toJSON(), { lang: lang })); }).then(function () { pushOn = true; });
}
function disablePush() {
  return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
    if (!sub) return;
    return jsend("/api/push/unsubscribe", "POST", { endpoint: sub.endpoint }).catch(function () {}).then(function () { return sub.unsubscribe(); });
  }).then(function () { pushOn = false; });
}
function settingsCard() {
  var perm = pushSupported() ? Notification.permission : "unsupported";
  return '<div class="inner"><h2>Notifications</h2><p class="sub">Recevez une alerte pour les messages, les appels vidéo et les demandes de confrères, même quand l\'application est fermée.</p>' +
    (perm === "denied" ? '<p class="note">Notifications bloquées dans le navigateur. Autorisez-les dans les réglages du site pour les activer.</p>'
      : '<button type="button" id="pushbtn" class="' + (pushOn ? "" : "pri") + '">' + ic("bell") + (pushOn ? "Désactiver les notifications" : "Activer les notifications") + '</button><p id="pushm" class="err"></p>') + "</div>";
}
function bindSettings() {
  var b = $("pushbtn"); if (!b) return;
  b.onclick = function () {
    b.disabled = true;
    (pushOn ? disablePush() : enablePush()).then(function () { route(); }).catch(function (e) { b.disabled = false; msg($("pushm"), e.message); });
  };
  if ($("delbtn")) $("delbtn").onclick = function () {
    if (!confirm(T("Supprimer définitivement votre compte, vos messages et votre profil ? Cette action est irréversible."))) return;
    jsend("/api/me", "DELETE", { password: $("delpw").value }).then(function () { me = null; unread = 0; pending = 0; stopInbox(); alert(T("Votre compte a été supprimé.")); go("#/"); }).catch(function (e) { msg($("delm"), e.message); });
  };
}
function deleteBox() {
  return '<details class="inner danger-zone"><summary>Supprimer mon compte</summary><p class="sub">Votre profil, vos messages et vos appels sont effacés pour toujours, ainsi que vos liens avec les confrères. Les reçus de paiement sont conservés sans votre nom.</p>' +
    '<label for="delpw">Mot de passe</label><input id="delpw" type="password" autocomplete="current-password"><button type="button" class="danger" id="delbtn">Supprimer définitivement mon compte</button><p id="delm" class="err"></p></details>';
}

// ---------- navigation et barre du haut ----------
function navItems() {
  var home = ["Accueil", "home", "#/", ["#/"]], fiches = ["Fiches", "book", "#/fiches", ["#/fiches"]];
  var docs = ["Médecins", "users", "#/medecins", ["#/medecins"]];
  var msgs = ["Messages", "chat", "#/messages", ["#/messages", "#/chat"], unread];
  var shop = ["Pharmacie", "bag", "#/pharmacie", ["#/pharmacie", "#/panier", "#/commandes"], cartCount()];
  if (!me) return [home, fiches, docs, shop, ["Connexion", "user", "#/compte", ["#/compte", "#/premium"]]];
  if (isDocOk()) return [home, ["Confrères", "users", "#/confreres", ["#/confreres", "#/reseau", "#/demandes"], pending], msgs, fiches, ["Profil", "user", "#/compte", ["#/compte"]]];
  if (isDoc()) return [home, fiches, ["Profil", "user", "#/compte", ["#/compte"]]];
  return [home, fiches, shop, msgs, ["Compte", "user", "#/compte", ["#/compte", "#/premium"]]];
}
function nav() {
  var cur = location.hash || "#/";
  $("nav").innerHTML = navItems().map(function (it) {
    var on = it[3].some(function (p) { return p === "#/" ? cur === "#/" : cur.indexOf(p) === 0; });
    return '<a href="' + it[2] + '"' + (on ? ' class="on" aria-current="page"' : "") + ">" + ic(it[1]) + "<span>" + it[0] + "</span>" + (it[4] ? '<span class="nbadge">' + it[4] + "</span>" : "") + "</a>";
  }).join("");
}
function renderBar() {
  $("who").innerHTML = me ? avatar(me, "sm") + '<span class="wn">' + esc(me.nom.replace(/^dr\.?\s+/i, "").split(" ")[0]) + "</span>" : ic("user") + '<span class="wn">Connexion</span>';
  var n = unread + pending;
  $("bell").className = "ibtn" + (me ? "" : " hide");
  $("bellN").textContent = n; $("bellN").className = "nbadge" + (n ? "" : " hide");
  $("bell").href = unread || !pending ? "#/messages" : "#/demandes";
}
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  stopTimers(); curReload = null;
  var h = location.hash || (isDoctorPath ? "#/compte" : "#/");
  nav(); renderBar();
  if (h === "#/") return viewHome();
  if (h === "#/fiches") return viewFiches();
  if (h === "#/medecins") return isDocOk() ? viewConfreres("annuaire") : viewMedecins();
  if (h === "#/confreres") return viewConfreres("annuaire");
  if (h === "#/reseau") return viewConfreres("reseau");
  if (h === "#/demandes") return viewConfreres("demandes");
  if (h === "#/compte") return viewCompte();
  if (h === "#/premium") return viewPremium();
  if (h === "#/commissions") return viewCommissions();
  if (h === "#/pharmacie") return viewPharmacie();
  if (h === "#/panier") return viewPanier();
  if (h === "#/commandes") return viewCommandes();
  if (h === "#/messages") return viewMessages();
  var m = h.match(/^#\/chat\/(\d+)$/);
  if (m) return viewChat(+m[1]);
  viewHome();
}
window.addEventListener("hashchange", function () { window.scrollTo(0, 0); route(); });
$("gform").onsubmit = function (e) { e.preventDefault(); fq = $("gq").value; fcat = -1; go("#/fiches"); };

// ---------- accueil ----------
function loadActivity(el, max) {
  api("/api/conversations").then(function (l) {
    if (!$(el)) return;
    $(el).innerHTML = l.length ? l.slice(0, max).map(function (c) {
      return '<a class="tli" href="#/chat/' + c.id + '">' + avatar(c.avec) + '<span class="grow"><b>' + esc((c.avec.role === "medecin" ? drName(c.avec.nom) : c.avec.nom)) + (c.non_lus ? ' <span class="dot">' + c.non_lus + "</span>" : "") +
        '</b><span class="meta">' + (c.dernier ? esc(c.dernier.texte) : "Aucun message") + "</span></span></a>";
    }).join("") : '<p class="sub">Aucune conversation pour le moment.</p>';
  }).catch(function () {});
}
function noteUrgence() {
  return '<p class="note">Ces conseils viennent d\'un livre de médecine populaire. Ils ne remplacent pas un médecin. En cas d\'urgence, rendez-vous aux urgences ou appelez les secours : la consultation en ligne n\'est pas faite pour les urgences.</p>';
}
function waTile() { return cfg.whatsapp ? tile("o", "chat", "Acheter un remède", waLink("Bonjour, je souhaite acheter un remède."), { ext: true, sub: "Aide sur WhatsApp" }) : ""; }
function payLine() { return '<p class="sub payline">' + t("Paiement par") + " <b>M-Pesa</b> · <b>Orange Money</b> · <b>Airtel Money</b> · <b>Afrimoney</b> · <b>Visa</b></p>"; }
function pushBanner() {
  if (!me || pushOn || !pushSupported() || Notification.permission === "denied" || sessionStorageGet("pd_pushno")) return "";
  return '<div class="note pushnote"><span>Activez les notifications pour ne manquer aucun message ni appel, même application fermée.</span> <button type="button" class="pri" data-act="pushon">Activer</button> <button type="button" class="ghost" data-act="pushno">Plus tard</button></div>';
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function installTile() { return standalone ? "" : tile("g", "down", "Installer l'application", "", { act: "install" }); }
function viewHome() {
  if (isDoc()) return homeDoctor();
  if (me) return homePatient();
  var s = fac.stats || {};
  var st = (s.medecins ? '<div class="stat"><b>' + s.medecins + "</b>médecins vérifiés</div>" : "") + (s.fiches ? '<div class="stat"><b>' + s.fiches + "</b>fiches relues</div>" : "") + (s.specialites ? '<div class="stat"><b>' + s.specialites + "</b>spécialités</div>" : "");
  $("view").innerHTML = '<section class="panel hero"><h1>Votre santé, avec l\'avis d\'un médecin</h1><p class="sub">Cherchez un mal pour lire des conseils relus par un médecin, trouvez un spécialiste et consultez-le en ligne par message ou en vidéo.</p>' +
    '<form id="hform" class="hsearch" role="search"><input id="hq" type="search" placeholder="Un mal, un symptôme" aria-label="Rechercher un mal"><button class="pri" type="submit">Chercher</button></form>' +
    (st ? '<div class="stats">' + st + "</div>" : "") + payLine() + "</section>" +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("y", "book", "Chercher un mal", "#/fiches") + tile("b", "users", "Trouver un médecin", "#/medecins") +
    tile("t", "video", "Consulter en ligne", "#/compte", { sub: "Message et vidéo" }) + tile("g", "bag", "Pharmacie", "#/pharmacie", { sub: "Paiement à la livraison" }) +
    tile("p", "star", "Passer Premium", "#/premium", { sub: t("{p} / mois", { p: money(cfg.price) }) }) +
    tile("k", "brief", "Espace médecin", "/medecin", { sub: "Inscription gratuite" }) + waTile() + installTile() + "</div></section>" +
    '<section class="panel hide" id="hdocs"><div class="panel-h"><h2>Médecins à votre service</h2><a href="#/medecins">Voir tous</a></div><div class="tl" id="hlist"></div></section>' + noteUrgence() + footer();
  $("hform").onsubmit = function (e) { e.preventDefault(); fq = $("hq").value; fcat = -1; go("#/fiches"); };
  api("/api/medecins").then(function (l) {
    if (!l.length || !$("hdocs")) return;
    $("hdocs").className = "panel";
    $("hlist").innerHTML = l.slice(0, 4).map(function (d) {
      return '<a class="tli" href="#/medecins">' + avatar(d) + '<span class="grow"><b>' + esc(drName(d.nom)) + '</b><span class="meta">' + esc(d.specialite) + (d.ville ? " · " + esc(d.ville) : "") + "</span></span>" +
        '<span class="b ' + (d.disponible ? "s" : "v") + '">' + (d.disponible ? "Disponible" : "Indisponible") + "</span></a>";
    }).join("");
  }).catch(function () {});
}
function homePatient() {
  var until = me.premium_until ? new Date(me.premium_until).toLocaleDateString("fr-FR") : "";
  $("view").innerHTML = '<div class="split"><section class="panel"><h2>Mon espace</h2><div class="inner"><div class="pro">' + avatar(me, "xl") + '<div class="grow"><h3>' + esc(me.nom) + '</h3><span class="meta">' + esc(me.telephone) + "</span><br>" +
    (me.premium ? '<span class="b s">Premium actif</span>' : '<span class="b v">Gratuit</span>') + "</div></div>" +
    '<div class="actions"><a class="ab" href="#/messages"><span class="c">' + ic("chat") + "</span>Messages" + (unread ? '<span class="nbadge">' + unread + "</span>" : "") + '</a><a class="ab" href="#/medecins"><span class="c">' + ic("users") + '</span>Médecins</a><a class="ab" href="#/premium"><span class="c">' + ic("star") + '</span>Premium</a><a class="ab" href="#/compte"><span class="c">' + ic("user") + "</span>Profil</a></div>" +
    '<dl class="kv"><dt>Abonnement</dt><dd>' + (me.premium ? t("jusqu'au {d}", { d: esc(until) }) : "aucun") + '</dd><dt>Consultations</dt><dd id="k1">…</dd><dt>Messages non lus</dt><dd id="k2">…</dd></dl></div>' +
    '<h2 style="margin-top:16px">Activité récente</h2><div class="tl" id="act"></div></section>' +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("y", "book", "Chercher un mal", "#/fiches") + tile("b", "users", "Trouver un médecin", "#/medecins") +
    tile("t", "chat", "Mes messages", "#/messages", { badge: unread || "" }) + tile("g", "bag", "Pharmacie", "#/pharmacie", { sub: "Paiement à la livraison" }) +
    tile("p", "star", me.premium ? "Prolonger Premium" : "Passer Premium", "#/premium", { sub: t("{p} / mois", { p: money(cfg.price) }) }) +
    tile("o", "user", "Mon profil", "#/compte") + waTile() + installTile() + "</div></section></div>" + pushBanner() + noteUrgence() + footer();
  loadActivity("act", 4);
  api("/api/tableau").then(function (t) { if ($("k1")) { $("k1").textContent = t.consultations; $("k2").textContent = t.non_lus; } }).catch(function () {});
}
function homeDoctor() {
  var ok = isDocOk();
  var banner = ok ? "" : me.statut === "refuse" ? '<p class="note bad-n">Votre inscription a été refusée. Contactez l\'administrateur.</p>'
    : '<p class="note">Votre inscription est en attente de validation. Complétez votre profil : l\'annuaire des confrères, le réseau et les consultations s\'ouvrent dès l\'approbation.</p>';
  var meta = [me.specialite, me.ville].filter(Boolean).map(esc).join(" · ");
  $("view").innerHTML = banner + '<div class="split"><section class="panel"><h2>Mon espace médecin</h2><div class="inner"><div class="pro">' + avatar(me, "xl") + '<div class="grow"><h3>' + esc(drName(me.nom)) + '</h3><span class="meta">' + meta + "</span><br>" +
    '<span class="meta">' + t("N° ordre : {n}", { n: esc(me.numero_ordre) }) + '</span><br><span class="b ' + (ok ? "s" : me.statut === "refuse" ? "u" : "p") + '">' + (ok ? "Compte validé" : me.statut === "refuse" ? "Refusé" : "En attente") + "</span></div></div>" +
    '<div class="actions"><a class="ab" href="#/messages"><span class="c">' + ic("chat") + "</span>Messages" + (unread ? '<span class="nbadge">' + unread + "</span>" : "") + "</a>" +
    '<a class="ab" href="#/confreres"><span class="c">' + ic("users") + "</span>Confrères</a>" +
    '<a class="ab" href="#/demandes"><span class="c">' + ic("userplus") + "</span>Demandes" + (pending ? '<span class="nbadge">' + pending + "</span>" : "") + "</a>" +
    '<a class="ab" href="#/commissions"><span class="c">' + ic("card") + "</span>Commissions</a>" +
    '<a class="ab" href="#/compte"><span class="c">' + ic("user") + "</span>Profil</a></div>" +
    '<dl class="kv"><dt>Consultations</dt><dd id="k1">…</dd><dt>Confrères connectés</dt><dd id="k2">…</dd><dt>Demandes en attente</dt><dd id="k3">…</dd></dl></div>' +
    (ok ? '<h2 style="margin-top:16px">Activité récente</h2><div class="tl" id="act"></div>' : "") + "</section>" +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("t", "chat", "Mes consultations", "#/messages", { badge: unread || "", off: !ok }) +
    tile("b", "users", "Trouver des confrères", "#/confreres", { off: !ok }) +
    tile("p", "userplus", "Demandes reçues", "#/demandes", { badge: pending || "", off: !ok }) +
    tile("g", "usercheck", "Mon réseau", "#/reseau", { off: !ok }) +
    tile("y", "card", "Mes commissions", "#/commissions", { off: !ok, sub: t("{p} par patient abonné", { p: money(cfg.part_medecin) }) }) +
    tile("o", "user", "Compléter mon profil", "#/compte") + tile("y", "book", "Fiches santé", "#/fiches") + installTile() + "</div></section></div>" + pushBanner() + footer();
  if (ok) loadActivity("act", 4);
  api("/api/tableau").then(function (t) { if ($("k1")) { $("k1").textContent = t.consultations; $("k2").textContent = t.confreres; $("k3").textContent = t.demandes; } }).catch(function () {});
}

// ---------- fiches ----------
function viewFiches() {
  $("view").innerHTML = '<section class="panel"><h1>Fiches santé</h1><p class="sub">Cherchez un mal pour voir les conseils relus par un médecin.</p>' + noteUrgence() +
    '<input id="q" type="search" placeholder="Un mal, un symptôme" aria-label="Recherche" value="' + esc(fq) + '">' +
    '<div class="chips" id="cats"></div><p class="sub" id="cnt"></p><div class="fl" id="list"></div><div id="upsell"></div>' +
    waButton("Bonjour, j'ai une question sur un remède.", "Écrire sur WhatsApp") + footer() + "</section>";
  $("q").oninput = function () { fq = $("q").value; clearTimeout(searchTimer); searchTimer = setTimeout(loadFiches, 250); };
  $("cats").onclick = function (e) { var c = e.target.getAttribute("data-c"); if (c === null) return; fcat = +c; chips(); loadFiches(); };
  chips(); loadFiches();
}
function chips() {
  var h = '<button data-c="-1" class="' + (fcat < 0 ? "on" : "") + '">Toutes</button>';
  cfg.cats.forEach(function (c, i) { h += '<button data-c="' + i + '" class="' + (fcat === i ? "on" : "") + '">' + esc(c) + "</button>"; });
  $("cats").innerHTML = h;
}
function premiumCta() {
  return me ? (me.role === "patient" ? '<a class="btn" href="#/premium">' + t("Passer Premium · {p} / mois", { p: money(cfg.price) }) + "</a>" : "")
    : '<a class="btn" href="#/compte">Créer un compte ou se connecter</a>';
}
function loadFiches() {
  api("/api/fiches?q=" + encodeURIComponent(fq) + "&cat=" + fcat).then(function (l) {
    if (!$("list")) return;
    $("cnt").textContent = t("{n} fiche(s)", { n: l.length }) + (lang !== "fr" ? " · " + T("Le contenu des fiches est en français.") : "");
    var locked = l.some(function (r) { return r.locked; });
    var sec = function (title, txt) { return txt ? "<h4>" + title + "</h4><p>" + esc(txt) + "</p>" : ""; };
    $("list").innerHTML = l.length ? l.map(function (r) {
      var gal = r.images && r.images.length ? '<div class="gal">' + r.images.map(function (i) {
        return '<figure><img loading="lazy" alt="' + esc(i.terme || r.nom) + '" src="/api/remede-img/' + i.id + '"><figcaption translate="no">' + esc(i.terme ? i.terme + " · " : "") + (i.source ? '<a target="_blank" rel="noopener" href="' + esc(i.source) + '">' + esc(i.auteur) + "</a>" : esc(i.auteur)) + (i.licence ? " · " + esc(i.licence) : "") + "</figcaption></figure>";
      }).join("") + "</div>" : "";
      return '<div class="card"><details><summary><span>' + esc(r.nom) + '<br><span class="meta">' + esc(cfg.cats[r.cat]) + '</span></span><span class="b ' + r.risque + '">' + RL[r.risque] + "</span></summary>" +
        sec("Causes", r.causes) + sec("Symptômes", r.symptomes) + sec("Conséquences", r.consequences) + sec("Remèdes du livre", r.remedes) + gal +
        (r.alerte ? '<div class="al"><b>Alerte :</b> ' + esc(r.alerte) + "</div>" : "") +
        (r.locked ? '<div class="lock">🔒 Aperçu limité. Le détail complet est réservé aux abonnés Premium.</div>' : "") +
        waButton("Bonjour, je souhaite acheter le remède pour : " + r.nom, "Acheter ce remède sur WhatsApp") + "</details></div>";
    }).join("") : '<div class="empty">' + ic("search") + "<p>Aucune fiche validée pour cette recherche.</p></div>";
    $("upsell").innerHTML = locked ? '<div class="card prem"><b>Voir toutes les fiches en détail</b><p class="sub">Symptômes complets, remèdes, consultation d\'un médecin par message et vidéo.</p>' + premiumCta() + "</div>" : "";
  }).catch(function () {});
}

// ---------- fiches de médecins : liste publique, annuaire des confrères, réseau ----------
function loadFacettes() {
  return api("/api/facettes").then(function (f) { fac = f; }).catch(function () {});
}
function filterBar() {
  var opt = function (l, cur, all) { return '<option value="">' + all + "</option>" + l.map(function (x) { return '<option' + (x.toLowerCase() === String(cur).toLowerCase() ? " selected" : "") + ">" + esc(x) + "</option>"; }).join(""); };
  return '<div class="filters"><div><label for="f-q">Recherche</label><input id="f-q" type="search" placeholder="Nom, ville, cabinet…" value="' + esc(flt.q) + '"></div>' +
    '<div><label for="f-sp">Spécialité</label><select id="f-sp">' + opt(fac.specialites, flt.sp, "Toutes") + "</select></div>" +
    '<div><label for="f-vi">Ville</label><select id="f-vi">' + opt(fac.villes, flt.vi, "Toutes") + "</select></div>" +
    '<label class="chk"><input type="checkbox" id="f-di"' + (flt.di ? " checked" : "") + "> Disponibles seulement</label></div>";
}
function bindFilters(reload) {
  var t;
  var upd = function () { flt.q = $("f-q").value; flt.sp = $("f-sp").value; flt.vi = $("f-vi").value; flt.di = $("f-di").checked; reload(); };
  $("f-q").oninput = function () { clearTimeout(t); t = setTimeout(upd, 250); };
  $("f-sp").onchange = upd; $("f-vi").onchange = upd; $("f-di").onchange = upd;
}
function filterQuery() {
  return "?q=" + encodeURIComponent(flt.q) + "&specialite=" + encodeURIComponent(flt.sp) + "&ville=" + encodeURIComponent(flt.vi) + (flt.di ? "&dispo=1" : "");
}
function pcard(d, actions) {
  var meta = [d.specialite, d.ville].filter(Boolean).map(esc).join(" · ");
  return '<article class="inner pcard">' + avatar(d, "xl") + '<div class="grow"><h3>' + esc(drName(d.nom)) + '</h3><div class="meta">' + meta + "</div>" +
    (d.cabinet ? '<div class="meta">' + ic("pin", "s") + esc(d.cabinet) + "</div>" : "") + (d.langues ? '<div class="meta">' + ic("globe", "s") + esc(d.langues) + "</div>" : "") +
    '<div><span class="b ' + (d.disponible ? "s" : "v") + '">' + (d.disponible ? "Disponible" : "Indisponible") + "</span>" + (d.experience ? '<span class="b v">' + t("{n} ans d'expérience", { n: d.experience }) + "</span>" : "") + "</div>" +
    (d.bio ? '<p class="bio" translate="no">' + esc(d.bio) + "</p>" : "") + (actions ? '<div class="pact">' + actions + "</div>" : "") + "</div></article>";
}
function emptyBox(icon, text) { return '<div class="empty">' + ic(icon) + "<p>" + text + "</p></div>"; }
function btn(act, id, label, cls, icon) { return '<button type="button" class="' + (cls || "") + '" data-act="' + act + '" data-i="' + id + '">' + (icon ? ic(icon) : "") + label + "</button>"; }
function confActions(d) {
  if (d.etat === "connecte") return btn("cmsg", d.id, "Message", "pri", "chat") + btn("cvid", d.id, "Appel vidéo", "", "video") + btn("unlink", d.id, "Retirer", "ghost");
  if (d.etat === "envoyee") return '<button type="button" disabled>Demande envoyée</button>' + btn("unlink", d.id, "Annuler", "ghost");
  if (d.etat === "recue") return btn("accept", d.id, "Accepter", "pri", "usercheck") + btn("unlink", d.id, "Refuser", "ghost");
  return btn("conn", d.id, "Se connecter", "pri", "userplus");
}

// liste publique (visiteurs et patients)
function viewMedecins() {
  $("view").innerHTML = '<section class="panel"><h1>Médecins</h1><p class="sub">Médecins vérifiés par l\'équipe. Le contact (message et vidéo) est réservé aux abonnés Premium.</p>' + '<div id="fbar">' + filterBar() + '</div><div class="grid2" id="docs"></div></section>';
  curReload = loadDocs;
  bindFilters(loadDocs); loadDocs();
  loadFacettes().then(function () { if ($("fbar") && document.activeElement && document.activeElement.id !== "f-q") { $("fbar").innerHTML = filterBar(); bindFilters(loadDocs); } });
}
function loadDocs() {
  api("/api/medecins" + filterQuery()).then(function (l) {
    if (!$("docs")) return;
    $("docs").innerHTML = l.length ? l.map(function (d) {
      var b = !me ? btn("login", d.id, "🔒 Contacter (Premium)")
        : isDoc() ? ""
        : me.premium ? btn("chat", d.id, "Contacter", "pri", "chat")
        : btn("prem", d.id, "🔒 Premium requis");
      return pcard(d, b);
    }).join("") : emptyBox("users", "Aucun médecin pour cette recherche.");
  }).catch(function () {});
}

// espace réseau des médecins : annuaire, mon réseau, demandes
function viewConfreres(tab) {
  if (!isDocOk()) { go("#/"); return; }
  ctab = tab;
  var T = function (id, label, badge) { return '<button data-act="tab" data-t="' + id + '" class="' + (ctab === id ? "on" : "") + '">' + label + (badge ? ' <span class="dot">' + badge + "</span>" : "") + "</button>"; };
  $("view").innerHTML = '<section class="panel"><h1>Confrères</h1><p class="sub">Retrouvez les autres médecins de la plateforme, connectez-vous, échangez et appelez-vous en vidéo.</p>' +
    '<div class="tabs">' + T("annuaire", "Annuaire") + T("reseau", "Mon réseau") + T("demandes", "Demandes", pending) + '</div><div id="cbody"></div></section>';
  if (tab === "annuaire") {
    $("cbody").innerHTML = '<div id="fbar">' + filterBar() + '</div><div class="grid2" id="res"></div>';
    var load = function () {
      api("/api/confreres" + filterQuery()).then(function (l) {
        if (!$("res")) return;
        $("res").innerHTML = l.length ? l.map(function (d) { return pcard(d, confActions(d)); }).join("") : emptyBox("users", "Aucun confrère pour cette recherche.");
      }).catch(function (e) { if ($("res")) $("res").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; });
    };
    curReload = load; bindFilters(load); load();
    loadFacettes().then(function () { if ($("fbar") && document.activeElement && document.activeElement.id !== "f-q") { $("fbar").innerHTML = filterBar(); bindFilters(load); } });
  } else {
    var loadNet = function () {
      api("/api/reseau").then(function (r) {
        if (!$("cbody")) return;
        pending = r.recues.length; nav(); renderBar();
        if (tab === "reseau") {
          $("cbody").innerHTML = r.connectes.length ? '<div class="grid2">' + r.connectes.map(function (d) { return pcard(d, confActions(d)); }).join("") + "</div>"
            : emptyBox("users", 'Vous n\'êtes encore connecté à aucun confrère.<br><br><a class="btn" href="#/confreres">Parcourir l\'annuaire</a>');
        } else {
          $("cbody").innerHTML = (r.recues.length ? "<h2>Demandes reçues</h2><div class=\"grid2\">" + r.recues.map(function (d) { return pcard(d, confActions(d)); }).join("") + "</div>" : emptyBox("userplus", "Aucune demande reçue pour le moment.")) +
            (r.envoyees.length ? '<h2 style="margin-top:18px">Demandes envoyées</h2><div class="grid2">' + r.envoyees.map(function (d) { return pcard(d, confActions(d)); }).join("") + "</div>" : "");
        }
      }).catch(function (e) { if ($("cbody")) $("cbody").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; });
    };
    curReload = loadNet; loadNet(); viewTimer = setInterval(loadNet, 10000);
  }
}
document.addEventListener("click", function (e) {
  var el = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!el) return;
  var a = el.getAttribute("data-act"), id = +el.getAttribute("data-i");
  var done = function () { if (curReload) curReload(); tickInbox(); };
  var fail = function (er) { alert(er.message); };
  if (a === "login") go("#/compte");
  else if (a === "prem") go("#/premium");
  else if (a === "install") $("install").onclick();
  else if (a === "pushon") enablePush().then(function () { route(); }).catch(function (er) { alert(er.message); });
  else if (a === "pushno") { try { sessionStorage.setItem("pd_pushno", "1"); } catch (x) { /* ignoré */ } route(); }
  else if (a === "tab") go("#/" + (el.getAttribute("data-t") === "annuaire" ? "confreres" : el.getAttribute("data-t")));
  else if (a === "chat") jsend("/api/conversations", "POST", { doctor_id: id }).then(function (c) { go("#/chat/" + c.id); }).catch(fail);
  else if (a === "conn") jsend("/api/confreres/" + id + "/connect", "POST").then(done).catch(fail);
  else if (a === "accept") jsend("/api/confreres/" + id + "/accept", "POST").then(done).catch(fail);
  else if (a === "unlink") api("/api/confreres/" + id, { method: "DELETE" }).then(done).catch(fail);
  else if (a === "cmsg" || a === "cvid") jsend("/api/confreres/" + id + "/conversation", "POST").then(function (c) { autoCall = a === "cvid"; go("#/chat/" + c.id); }).catch(fail);
});

// ---------- compte ----------
function viewCompte() {
  if (!me) return viewAuth();
  if (me.role === "medecin") return viewDoctor();
  var until = me.premium_until ? new Date(me.premium_until).toLocaleDateString("fr-FR") : "";
  $("view").innerHTML = '<section class="panel"><h1>Mon compte</h1><div class="split"><div class="inner"><div class="row-s">' + avatar(me, "xl") + '<div class="grow"><h3>' + esc(me.nom) + '</h3><span class="meta">' + esc(me.telephone) + "</span></div></div>" +
    (me.premium ? '<p><span class="b s">Premium actif</span> jusqu\'au ' + esc(until) + "</p>" : '<p><span class="b v">Gratuit</span> Accès limité : aperçu des fiches, liste des médecins.</p>') +
    '<a class="btn' + (me.premium ? "" : " pri") + '" href="#/premium">' + (me.premium ? T("Prolonger de 30 jours") : t("Passer Premium · {p} / mois", { p: money(cfg.price) })) + "</a> " + '<button id="out" type="button">' + ic("out") + "Se déconnecter</button></div>" +
    '<div class="inner"><h2>Mon profil</h2>' + (me.premium ? profileForm(false) : '<p class="sub">🔒 Le profil complet (photo, ville, présentation) est réservé aux abonnés Premium.</p>') + "</div></div>" +
    '<div class="split2">' + settingsCard() + deleteBox() + "</div>" + footer() + "</section>";
  bindProfile(false); bindSettings(); $("out").onclick = logout;
}
function profileForm(doc) {
  return '<label for="pn">Nom complet</label><input id="pn" value="' + esc(me.nom) + '" autocomplete="name">' +
    (doc ? '<label for="ps">Spécialité</label><input id="ps" value="' + esc(me.specialite) + '" placeholder="Ex : Pédiatrie, Médecine générale">' : "") +
    '<label for="pv">Ville</label><input id="pv" value="' + esc(me.ville) + '">' +
    (doc ? '<label for="pc">Cabinet ou hôpital</label><input id="pc" value="' + esc(me.cabinet) + '" placeholder="Ex : Clinique Ngaliema"><div class="row"><div><label for="pl">Langues parlées</label><input id="pl" value="' + esc(me.langues) + '" placeholder="Français, lingala"></div>' +
      '<div><label for="pe">Années d\'expérience</label><input id="pe" type="number" min="0" max="70" value="' + esc(me.experience || "") + '"></div></div>' : "") +
    '<label for="pb">' + (doc ? "Présentation" : "À propos de moi") + '</label><textarea id="pb" rows="3" maxlength="800">' + esc(me.bio) + "</textarea>" +
    (doc ? '<label class="chk"><input type="checkbox" id="pd"' + (me.disponible ? " checked" : "") + "> Disponible pour les consultations</label>" : "") +
    '<label for="pf">Photo de profil</label><input id="pf" type="file" accept="image/*">' +
    '<button class="pri" id="psave" type="button">Enregistrer</button><p id="pm" class="err"></p>';
}
function bindProfile(doc) {
  if (!$("psave")) return;
  $("psave").onclick = function () {
    var b = { nom: $("pn").value, ville: $("pv").value, bio: $("pb").value };
    if (doc) { b.specialite = $("ps").value; b.disponible = $("pd").checked; b.cabinet = $("pc").value; b.langues = $("pl").value; b.experience = $("pe").value; }
    var url = doc && me.statut !== "approuve" ? "/api/me/profile-attente" : "/api/me/profile";
    jsend(url, "PUT", b).then(function () {
      var f = $("pf").files[0];
      if (!f) return;
      var fd = new FormData(); fd.append("file", f);
      return api("/api/me/photo", { method: "POST", body: fd });
    }).then(function () { return loadMe(); }).then(function () { route(); if ($("pm")) msg($("pm"), "Profil enregistré.", true); }).catch(function (e) { msg($("pm"), e.message); });
  };
}
function logout() { (pushSupported() ? navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { return sub ? jsend("/api/push/unsubscribe", "POST", { endpoint: sub.endpoint }).catch(function () {}) : null; }).catch(function () {}) : Promise.resolve()).then(function () { return jsend("/api/user/logout", "POST"); }).then(function () { pushOn = false; me = null; unread = 0; pending = 0; stopInbox(); go("#/"); }); }

function viewAuth() {
  var doc = isDoctorPath;
  var perks = doc ? ["Un profil visible des patients : photo, spécialité, cabinet", "Consultations par message et en vidéo", "Un réseau de confrères pour échanger et s'entraider", "Gratuit : votre numéro d'ordre est vérifié avant l'ouverture"]
    : ["Fiches complètes : symptômes, remèdes, alertes", "Message direct avec les médecins", "Consultation vidéo", "Profil avec photo"];
  $("view").innerHTML = '<section class="panel"><h1>' + (doc ? "Espace médecin" : "Mon compte") + "</h1>" +
    '<p class="sub">' + (doc ? "Rejoignez la plateforme et retrouvez vos confrères." : "Créez un compte gratuit, puis passez Premium pour l'accès complet.") + '</p><div class="auth"><div class="inner"><ul class="ticks">' + perks.map(function (p) { return "<li>" + p + "</li>"; }).join("") + "</ul>" +
    (doc ? '<p class="sub"><a href="/#/compte">Vous êtes patient ? Cliquez ici.</a></p>' : '<p class="sub"><a href="/medecin">Vous êtes médecin ? Accédez à l\'espace médecin.</a></p>') + "</div><div>" +
    '<div class="tabs"><button id="t-in" class="on">Connexion</button><button id="t-up">Créer un compte</button></div>' +
    '<div class="inner" id="f-in"><label for="lt">Téléphone</label><input id="lt" type="tel" autocomplete="tel" placeholder="0812345678">' +
    '<label for="lp">Mot de passe</label><input id="lp" type="password" autocomplete="current-password"><button class="pri" id="lgo">Se connecter</button><p id="lm" class="err"></p></div>' +
    '<div class="inner hide" id="f-up"><label for="rn">Nom complet</label><input id="rn" autocomplete="name" placeholder="Prénom et nom">' +
    '<label for="rt">Téléphone</label><input id="rt" type="tel" autocomplete="tel" placeholder="0812345678">' +
    '<label for="rp">Mot de passe (8 caractères minimum)</label><input id="rp" type="password" autocomplete="new-password">' +
    (doc ? '<label for="rs">Spécialité</label><input id="rs" placeholder="Ex : Médecine générale"><label for="ro">Numéro d\'ordre des médecins</label><input id="ro">' : "") +
    '<label class="chk"><input type="checkbox" id="rc"> J\'accepte que mes données de santé (messages, profil) soient traitées pour les consultations. Dans l\'application, elles ne sont affichées qu\'à moi et à mon médecin.</label>' +
    '<button class="pri" id="rgo">Créer mon compte</button><p id="rm" class="err"></p></div></div></div>' + footer() + "</section>";
  $("t-in").onclick = function () { $("f-in").className = "inner"; $("f-up").className = "inner hide"; $("t-in").className = "on"; $("t-up").className = ""; };
  $("t-up").onclick = function () { $("f-up").className = "inner"; $("f-in").className = "inner hide"; $("t-up").className = "on"; $("t-in").className = ""; };
  $("lgo").onclick = function () {
    jsend("/api/user/login", "POST", { telephone: $("lt").value, password: $("lp").value }).then(afterAuth).catch(function (e) { msg($("lm"), e.message); });
  };
  $("rgo").onclick = function () {
    jsend("/api/register", "POST", { nom: $("rn").value, telephone: $("rt").value, password: $("rp").value, role: doc ? "medecin" : "patient",
      specialite: doc ? $("rs").value : "", numero_ordre: doc ? $("ro").value : "", consent: $("rc").checked }).then(afterAuth).catch(function (e) { msg($("rm"), e.message); });
  };
}
function afterAuth() { return loadMe().then(function () { startInbox(); syncPush(); if (location.hash === "#/") route(); else location.hash = "#/"; }); }

// ---------- profil du médecin ----------
function viewDoctor() {
  var st = me.statut;
  var banner = st === "approuve" ? '<p class="note ok-n">Compte validé : vous apparaissez dans la liste des médecins et dans l\'annuaire des confrères.</p>'
    : st === "refuse" ? '<p class="note bad-n">Votre inscription a été refusée. Contactez l\'administrateur.</p>'
    : '<p class="note">Votre inscription est en attente de validation. Complétez votre profil : vous serez visible dès l\'approbation.</p>';
  $("view").innerHTML = '<section class="panel"><h1>Mon profil</h1>' + banner + '<div class="split"><div><p class="sub">Voici comment les autres vous voient.</p>' + pcard(me, "") +
    '<p style="margin-top:12px"><button id="out" type="button">' + ic("out") + "Se déconnecter</button></p></div>" +
    '<div class="inner"><h2>Modifier mon profil</h2>' + profileForm(true) + "</div></div>" +
    '<div class="split2">' + settingsCard() + deleteBox() + "</div>" + footer() + "</section>";
  bindProfile(true); bindSettings(); $("out").onclick = logout;
}

// ---------- paiement Premium ----------
function viewCommissions() {
  if (!isDoc()) { go("#/"); return; }
  $("view").innerHTML = '<section class="panel"><h1>Mes commissions</h1><div class="inner"><p class="sub">' + t("Quand un patient s'abonne puis vous contacte, {p} vous reviennent pour la consultation.", { p: money(cfg.part_medecin) }) + '</p><div id="cm">…</div></div></section>' + footer();
  api("/api/me/commissions").then(function (r) {
    if (!$("cm")) return;
        var fm = function (n) { return Number(n).toLocaleString("fr-FR").replace(/[\u202f\u00a0 ]/g, "\u00a0") + "\u00a0" + (r.devise === "CDF" ? "FC" : r.devise); };
    var lab = { attribuee: "À recevoir", payee: "Payée" };
    $("cm").innerHTML = '<dl class="kv"><dt>À recevoir</dt><dd>' + fm(r.a_payer) + "</dd><dt>Déjà payé</dt><dd>" + fm(r.payees) + "</dd><dt>Total</dt><dd><b>" + fm(r.total) + "</b></dd></dl>" +
      (r.lignes.length ? '<div class="tl">' + r.lignes.map(function (l) {
        return '<div class="tli"><span class="grow"><b>' + esc(l.patient) + '</b><span class="meta">' + esc(new Date(l.date).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")) + "</span></span><span><b>" + fm(l.montant) + '</b><br><span class="b ' + (l.statut === "payee" ? "s" : "p") + '">' + T(lab[l.statut] || l.statut) + "</span></span></div>";
      }).join("") + "</div>" : '<p class="sub">' + T("Aucune commission pour le moment.") + "</p>");
    applyLang();
  }).catch(function (e) { if ($("cm")) $("cm").textContent = e.message; });
}
function viewPremium() {
  if (!me) { go("#/compte"); return; }
  if (me.role === "medecin") { go("#/compte"); return; }
  var q = new URLSearchParams(location.search), ref = q.get("ref");
  $("view").innerHTML = '<section class="panel"><h1>Passer Premium</h1><div class="split"><div class="inner prem"><p class="big">' + money(cfg.price) + ' <span class="sub">' + t("/ {n} jours", { n: cfg.days }) + '</span></p><p class="sub">' + t("Sur ce montant, {m} reviennent au médecin que vous contactez et {a} à la plateforme.", { m: money(cfg.part_medecin), a: money(cfg.part_admin) }) + '</p><ul class="ticks"><li>Fiches complètes : symptômes, remèdes, alertes</li><li>Message direct avec les médecins</li><li>Consultation vidéo</li><li>Profil avec photo</li></ul>' + payLine() + '</div>' +
    (cfg.paiement ? '<div class="inner"><label>Moyen de paiement</label><div class="chips"><button id="m-mob" class="on">Mobile Money (M-Pesa, Orange, Airtel, Afrimoney)</button><button id="m-card">Carte bancaire (Visa)</button></div>' +
      '<div id="mobbox"><label for="pph">Numéro Mobile Money (M-Pesa, Orange Money, Airtel Money ou Afrimoney)</label><input id="pph" type="tel" value="' + esc(me.telephone) + '" placeholder="0812345678"></div>' +
      '<button class="pri" id="pay">' + t("Payer {p}", { p: money(cfg.price) }) + '</button><p id="paym" class="err"></p></div>' :
      '<p class="note">Le paiement n\'est pas encore activé sur ce serveur.</p>') + "</div></section>";
  var method = "mobile";
  if ($("m-mob")) {
    $("m-mob").onclick = function () { method = "mobile"; $("m-mob").className = "on"; $("m-card").className = ""; $("mobbox").className = ""; };
    $("m-card").onclick = function () { method = "card"; $("m-card").className = "on"; $("m-mob").className = ""; $("mobbox").className = "hide"; };
    $("pay").onclick = function () {
      $("pay").disabled = true; msg($("paym"), "");
      jsend("/api/premium/pay", "POST", { method: method, phone: $("pph") ? $("pph").value : "" }).then(function (r) {
        if (r.url) { location.href = r.url; return; }
        msg($("paym"), "Confirmez le paiement sur votre téléphone (code secret Mobile Money)…", true);
        waitPayment(r.ref);
      }).catch(function (e) { $("pay").disabled = false; msg($("paym"), e.message); });
    };
  }
  if (ref) { var d = document.createElement("p"); d.id = "paym2"; d.className = "ok"; d.textContent = "Vérification de votre paiement…"; $("view").appendChild(d); waitPayment(ref); }
}
function waitPayment(ref) {
  var n = 0;
  stopTimers();
  viewTimer = setInterval(function () {
    n++;
    api("/api/premium/order/" + encodeURIComponent(ref)).then(function (r) {
      if (r.status === "paid") { stopTimers(); history.replaceState(null, "", "/#/compte"); loadMe().then(function () { alert("Paiement reçu. Votre accès Premium est actif."); go("#/compte"); }); }
      else if (r.status === "failed") { stopTimers(); if ($("pay")) $("pay").disabled = false; var el = $("paym") || $("paym2"); if (el) msg(el, "Paiement non abouti. Vous pouvez réessayer."); }
    }).catch(function () {});
    if (n > 75) stopTimers();
  }, 4000);
}

// ---------- pharmacie : catalogue, panier, commandes (paiement à la livraison) ----------
var cart = cartLoad(), phCat = "", phQ = "", phInfo = { frais: 0 };
function cartLoad() { try { var c = JSON.parse(localStorage.getItem("pd_cart") || "{}"); return c && typeof c === "object" && !Array.isArray(c) ? c : {}; } catch (e) { return {}; } }
function cartSave() { try { localStorage.setItem("pd_cart", JSON.stringify(cart)); } catch (e) { /* stockage indisponible */ } }
function cartCount() { var n = 0; for (var k in cart) n += cart[k].q; return n; }
function cartSub() { var s = 0; for (var k in cart) s += cart[k].q * cart[k].prix; return s; }
function cartNeedsRx() { for (var k in cart) if (cart[k].rx) return true; return false; }
function cartAdd(p) {
  var c = cart[p.id], q = (c ? c.q : 0) + 1;
  if (!p.dispo || q > Math.min(p.stock, 20)) return false;
  cart[p.id] = { q: q, nom: p.nom, prix: p.prix, rx: p.ordonnance, stock: p.stock, image: p.image || "" };
  cartSave(); return true;
}
function cartBar() {
  var n = cartCount(); if (!$("phbar")) return;
  $("phbar").innerHTML = n ? '<a class="cartbar" href="#/panier">' + ic("bag") + "<span>" + t("{n} article(s) · {p}", { n: n, p: money(cartSub()) }) + '</span><b>' + T("Voir le panier") + "</b></a>" : "";
  nav();
}
function phStatut(s) { return { nouvelle: "Nouvelle", confirmee: "Confirmée", en_livraison: "En livraison", livree: "Livrée et payée", annulee: "Annulée" }[s] || s; }
function phStatutCls(s) { return { nouvelle: "p", confirmee: "p", en_livraison: "p", livree: "s", annulee: "v" }[s] || "v"; }
function viewPharmacie() {
  $("view").innerHTML = '<section class="panel"><h1>Pharmacie</h1><p class="sub">Choisissez vos produits et recevez-les chez vous. <b>Vous payez à la livraison</b>, en espèces, au livreur.</p>' +
    '<form id="phf" class="hsearch" role="search"><input id="phq" type="search" placeholder="Rechercher un produit" aria-label="Rechercher un produit" value="' + esc(phQ) + '"><button class="pri" type="submit">Chercher</button></form>' +
    '<div class="chips" id="phc"></div><div class="pgrid" id="phl"></div>' +
    '<p class="note">Les produits « Sur ordonnance » ne sont livrés qu\'avec la photo de l\'ordonnance. Ces produits ne remplacent pas l\'avis d\'un médecin.</p>' + footer() + '</section><div id="phbar"></div>';
  $("phf").onsubmit = function (e) { e.preventDefault(); phQ = $("phq").value; phLoad(); };
  $("phc").onclick = function (e) { var c = e.target.getAttribute("data-c"); if (c === null) return; phCat = c; phLoad(); };
  $("phl").onclick = function (e) {
    var b = e.target.closest ? e.target.closest("[data-add]") : null; if (!b) return;
    var p = (phList || []).filter(function (x) { return x.id === +b.getAttribute("data-add"); })[0];
    if (p && cartAdd(p)) { b.textContent = T("Ajouté ✓"); setTimeout(function () { if (b) b.textContent = T("Ajouter"); }, 900); cartBar(); }
    else if (p) alert(T("Quantité maximale atteinte pour ce produit."));
  };
  phLoad(); cartBar();
}
var phList = [];
function phLoad() {
  api("/api/pharmacie/produits?cat=" + encodeURIComponent(phCat) + "&q=" + encodeURIComponent(phQ)).then(function (r) {
    if (!$("phl")) return;
    phList = r.produits; phInfo.frais = r.frais;
    $("phc").innerHTML = r.cats.length ? '<button type="button" data-c="" class="' + (phCat === "" ? "on" : "") + '">' + T("Tout") + "</button>" + r.cats.map(function (c) { return '<button type="button" data-c="' + esc(c) + '" class="' + (phCat === c ? "on" : "") + '" translate="no">' + esc(c) + "</button>"; }).join("") : "";
    $("phl").innerHTML = r.produits.length ? r.produits.map(function (p) {
      return '<article class="prod"><div class="pimg">' + (p.image ? '<img alt="" loading="lazy" src="' + esc(p.image) + '">' : ic("bag")) + '</div><div class="pbody"><b translate="no">' + esc(p.nom) + "</b>" +
        '<div>' + (p.ordonnance ? '<span class="b p">Sur ordonnance</span>' : "") + (!p.dispo ? '<span class="b u">Rupture de stock</span>' : p.stock <= 5 ? '<span class="b v">' + t("Plus que {n}", { n: p.stock }) + "</span>" : "") + "</div>" +
        (p.description ? '<p class="sub" translate="no">' + esc(p.description) + "</p>" : "") +
        '<div class="pfoot"><span class="pprice">' + money(p.prix) + "</span>" + (p.dispo ? '<button type="button" class="pri" data-add="' + p.id + '">' + T("Ajouter") + "</button>" : "") + "</div></div></article>";
    }).join("") : emptyBox("bag", T("Aucun produit pour le moment."));
  }).catch(function () { if ($("phl")) $("phl").innerHTML = emptyBox("bag", T("Impossible de charger la pharmacie. Réessayez.")); });
}
function viewPanier() {
  var keys = Object.keys(cart);
  if (!keys.length) { $("view").innerHTML = '<section class="panel"><h1>Mon panier</h1>' + emptyBox("bag", T("Votre panier est vide.")) + '<p style="text-align:center"><a class="btn pri" href="#/pharmacie">' + T("Voir la pharmacie") + "</a></p></section>"; return; }
  // actualise prix, stock et disponibilité avant de commander
  api("/api/pharmacie/produits").then(function (r) {
    phInfo.frais = r.frais;
    var by = {}; r.produits.forEach(function (p) { by[p.id] = p; });
    var removed = [];
    Object.keys(cart).forEach(function (k) {
      var p = by[k];
      if (!p || !p.dispo) { removed.push(cart[k].nom); delete cart[k]; return; }
      cart[k].prix = p.prix; cart[k].stock = p.stock; cart[k].rx = p.ordonnance; cart[k].image = p.image || "";
      if (cart[k].q > Math.min(p.stock, 20)) cart[k].q = Math.min(p.stock, 20);
    });
    cartSave(); drawPanier(removed);
  }).catch(function () { drawPanier([]); });
  nav();
}
function drawPanier(removed) {
  var keys = Object.keys(cart);
  if (!keys.length) { nav(); $("view").innerHTML = '<section class="panel"><h1>Mon panier</h1>' + (removed.length ? '<p class="note">' + T("Ces produits ne sont plus disponibles :") + " <span translate=\"no\">" + esc(removed.join(", ")) + "</span></p>" : "") + emptyBox("bag", T("Votre panier est vide.")) + '<p style="text-align:center"><a class="btn pri" href="#/pharmacie">' + T("Voir la pharmacie") + "</a></p></section>"; return; }
  var sub = cartSub(), fr = phInfo.frais || 0, rx = cartNeedsRx(), canOrder = me && me.role === "patient";
  var lines = keys.map(function (k) {
    var c = cart[k];
    return '<div class="cline"><div class="pimg sm">' + (c.image ? '<img alt="" src="' + esc(c.image) + '">' : ic("bag")) + '</div><div class="grow"><b translate="no">' + esc(c.nom) + "</b>" + (c.rx ? ' <span class="b p">Sur ordonnance</span>' : "") + '<div class="meta">' + money(c.prix) + '</div></div>' +
      '<div class="qty"><button type="button" data-q="' + k + '|-1" aria-label="' + T("Retirer un") + '">−</button><span>' + c.q + '</span><button type="button" data-q="' + k + '|1" aria-label="' + T("Ajouter un") + '">+</button></div><b class="lt">' + money(c.q * c.prix) + "</b></div>";
  }).join("");
  var form = canOrder ? '<div class="inner"><h2>Livraison</h2>' +
    '<label for="ph-tel">Téléphone</label><input id="ph-tel" type="tel" value="' + esc(me.telephone) + '" placeholder="0812345678">' +
    '<label for="ph-adr">Adresse de livraison</label><input id="ph-adr" placeholder="Avenue, numéro, repère" maxlength="240" autocomplete="street-address">' +
    '<label for="ph-qt">Quartier ou commune</label><input id="ph-qt" placeholder="Ex : Gombe, Limete, Ngaliema" maxlength="80">' +
    '<label for="ph-note">Message pour le livreur (facultatif)</label><input id="ph-note" maxlength="400">' +
    (rx ? '<label for="ph-rx">Photo de l\'ordonnance</label><input id="ph-rx" type="file" accept="image/*"><p class="sub">Un produit de votre panier est vendu sur ordonnance : la photo est obligatoire. Elle n\'est vue que par l\'administrateur.</p>' : "") +
    '<p class="note ok-n">' + T("Paiement à la livraison : aucun paiement en ligne. Vous payez en espèces au livreur, à la réception de votre commande.") + '</p>' +
    '<button class="pri" id="ph-go" type="button">' + t("Commander · {p} à payer à la livraison", { p: money(sub + fr) }) + '</button><p id="ph-m" class="err"></p></div>' :
    '<div class="inner">' + (me ? '<p class="note">' + T("Les commandes sont réservées aux comptes patients.") + "</p>" : '<p class="note">' + T("Connectez-vous ou créez un compte patient pour commander. Vous payez seulement à la livraison.") + '</p><a class="btn pri" href="#/compte">' + T("Connexion ou inscription") + "</a>") + "</div>";
  $("view").innerHTML = '<section class="panel"><h1>Mon panier</h1>' + (removed.length ? '<p class="note">' + T("Ces produits ne sont plus disponibles :") + ' <span translate="no">' + esc(removed.join(", ")) + "</span></p>" : "") +
    '<div id="cl">' + lines + '</div><dl class="kv"><dt>Sous-total</dt><dd>' + money(sub) + "</dd><dt>Livraison</dt><dd>" + (fr ? money(fr) : T("Offerte")) + "</dd><dt><b>" + T("Total à payer à la livraison") + "</b></dt><dd><b>" + money(sub + fr) + "</b></dd></dl>" +
    '<p><a href="#/pharmacie">' + T("← Continuer mes achats") + "</a></p></section>" + (canOrder || true ? '<section class="panel">' + form + "</section>" : "");
  nav();
  $("cl").onclick = function (e) {
    var v = e.target.getAttribute("data-q"); if (!v) return; var a = v.split("|"), c = cart[a[0]]; if (!c) return;
    var q = c.q + (+a[1]);
    if (q < 1) delete cart[a[0]]; else if (q > Math.min(c.stock, 20)) { alert(T("Quantité maximale atteinte pour ce produit.")); return; } else c.q = q;
    cartSave(); drawPanier([]);
  };
  if ($("ph-go")) $("ph-go").onclick = function () {
    var fd = new FormData();
    fd.append("items", JSON.stringify(Object.keys(cart).map(function (k) { return { id: +k, qte: cart[k].q }; })));
    fd.append("telephone", $("ph-tel").value); fd.append("adresse", $("ph-adr").value); fd.append("quartier", $("ph-qt").value); fd.append("note", $("ph-note").value);
    if (rx) { var f = $("ph-rx").files[0]; if (!f) { msg($("ph-m"), "Ajoutez la photo de l'ordonnance."); return; } fd.append("ordonnance", f); }
    $("ph-go").disabled = true; msg($("ph-m"), "");
    api("/api/pharmacie/commandes", { method: "POST", body: fd }).then(function (c) {
      cart = {}; cartSave(); nav(); drawConfirmation(c);
    }).catch(function (e) { $("ph-go").disabled = false; msg($("ph-m"), e.message); if (e.status === 409) setTimeout(viewPanier, 1800); });
  };
}
function drawConfirmation(c) {
  var wa = "Bonjour, je viens de passer la commande " + c.ref + " sur Petit Docteur (" + Number(c.total).toLocaleString("fr-FR") + " FC, paiement à la livraison).";
  $("view").innerHTML = '<section class="panel"><div class="done">' + ic("bag") + "<h1>" + T("Commande envoyée") + '</h1><p class="big" translate="no">' + esc(c.ref) + "</p>" +
    '<p class="sub">' + T("Gardez ce numéro. L'administrateur va confirmer votre commande et vous appeler au besoin.") + "</p>" +
    '<dl class="kv"><dt>Total à payer à la livraison</dt><dd><b>' + money(c.total) + "</b></dd><dt>Adresse</dt><dd translate=\"no\">" + esc(c.adresse) + (c.quartier ? ", " + esc(c.quartier) : "") + "</dd></dl>" +
    '<p class="note ok-n">' + T("Vous payez en espèces au livreur, à la réception.") + "</p>" +
    '<div class="row2"><a class="btn pri" href="#/commandes">' + T("Suivre ma commande") + "</a>" + waButton(wa, T("Prévenir sur WhatsApp")) + "</div></div></section>";
}
function viewCommandes() {
  if (!me) { go("#/compte"); return; }
  $("view").innerHTML = '<section class="panel"><h1>Mes commandes</h1><div id="cmdl"><p class="sub">Chargement…</p></div><p><a href="#/pharmacie">' + T("Voir la pharmacie") + "</a></p></section>";
  api("/api/pharmacie/commandes").then(function (l) {
    $("cmdl").innerHTML = l.length ? l.map(function (c) {
      return '<article class="inner"><b translate="no">' + esc(c.ref) + '</b> <span class="b ' + phStatutCls(c.statut) + '">' + T(phStatut(c.statut)) + '</span><div class="meta">' + esc(new Date(c.date).toLocaleString("fr-FR")) + "</div>" +
        '<ul class="cl2">' + c.lignes.map(function (x) { return "<li><span translate=\"no\">" + x.qte + " × " + esc(x.nom) + "</span> <span class=\"meta\">" + money(x.prix * x.qte) + "</span></li>"; }).join("") + "</ul>" +
        '<div class="meta">' + T("Livraison") + " : " + (c.frais ? money(c.frais) : T("Offerte")) + "</div><b>" + (c.statut === "livree" ? T("Payé à la livraison") : c.statut === "annulee" ? T("Commande annulée") : T("À payer à la livraison")) + " : " + money(c.total) + "</b>" +
        (c.statut === "nouvelle" ? '<div class="pact"><button type="button" data-cx="' + c.id + '">' + T("Annuler la commande") + "</button></div>" : "") + "</article>";
    }).join("") : emptyBox("bag", T("Vous n'avez pas encore de commande."));
    $("cmdl").onclick = function (e) {
      var id = e.target.getAttribute("data-cx"); if (!id || !confirm(T("Annuler cette commande ?"))) return;
      jsend("/api/pharmacie/commandes/" + id + "/annuler", "POST").then(viewCommandes).catch(function (x) { alert(x.message); });
    };
  }).catch(function (e) { $("cmdl").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; });
}

// ---------- messages ----------
function viewMessages() {
  if (!me) { go("#/compte"); return; }
  $("view").innerHTML = '<section class="panel"><h1>' + (isDoc() ? "Consultations et échanges" : "Messages") + '</h1><div class="tl" id="convs"></div></section>';
  function load() {
    api("/api/conversations").then(function (l) {
      if (!$("convs")) return;
      $("convs").innerHTML = l.length ? l.map(function (c) {
        return '<a class="tli" href="#/chat/' + c.id + '">' + avatar(c.avec, "lg") + '<span class="grow"><b>' + esc(c.avec.role === "medecin" ? drName(c.avec.nom) : c.avec.nom) + (c.non_lus ? ' <span class="dot">' + c.non_lus + "</span>" : "") +
          '</b><span class="meta">' + (c.dernier ? esc(c.dernier.texte) : "Aucun message") + "</span></span></a>";
      }).join("") : emptyBox("chat", me.role === "patient" ? 'Aucune consultation. <a href="#/medecins">Choisissez un médecin.</a>' : isDocOk() ? 'Aucune conversation. <a href="#/confreres">Retrouvez vos confrères.</a>' : "Aucune consultation pour le moment.");
    }).catch(function () {});
  }
  load(); viewTimer = setInterval(load, 5000);
}
function viewChat(id) {
  if (!me) { go("#/compte"); return; }
  $("view").innerHTML = '<section class="panel"><p><a href="#/messages">← Messages</a></p><div class="inner row-s" id="chead"></div><div class="chat" id="msgs" aria-live="polite"></div>' +
    '<div class="row"><input id="mt" placeholder="Votre message" maxlength="2000" aria-label="Message"><button class="pri" id="ms" style="flex:0 0 auto">Envoyer</button></div><p id="mm" class="err"></p></section>';
  var last = 0, avec = null, first = true;
  function paint(l) {
    var box = $("msgs"); if (!box) return;
    var near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    l.forEach(function (m) {
      last = Math.max(last, m.id);
      var d = document.createElement("div"); d.className = "bub " + (m.from_id === me.id ? "me" : "you"); d.setAttribute("translate", "no");
      d.innerHTML = esc(m.texte).replace(/\n/g, "<br>") + '<span class="t">' + esc(m.ts.slice(11, 16)) + "</span>"; box.appendChild(d);
    });
    if (near || first) box.scrollTop = box.scrollHeight;
    first = false;
  }
  function poll() {
    api("/api/conversations/" + id + "/messages?after=" + last).then(function (r) {
      if (!avec) {
        avec = r.avec;
        $("chead").innerHTML = avatar(avec, "lg") + '<div class="grow"><b>' + esc((avec.role === "medecin" ? drName(avec.nom) : avec.nom)) + '</b><br><span class="meta">' + esc(avec.specialite || "Patient") + '</span></div><button id="vc" class="pri" type="button">' + ic("video") + "Appel vidéo</button>";
        var startCall = function () { jsend("/api/conversations/" + id + "/call", "POST").then(function (c) { openCall(c, true); }).catch(function (e) { msg($("mm"), e.message); }); };
        $("vc").onclick = startCall;
        if (autoCall) { autoCall = false; startCall(); }
      }
      paint(r.messages);
    }).catch(function (e) { if (e.status === 404) go("#/messages"); });
  }
  function send() {
    var t = $("mt").value.trim(); if (!t) return;
    jsend("/api/conversations/" + id + "/messages", "POST", { texte: t }).then(function () { $("mt").value = ""; msg($("mm"), ""); poll(); }).catch(function (e) { msg($("mm"), e.message); });
  }
  $("ms").onclick = send; $("mt").onkeydown = function (e) { if (e.key === "Enter") send(); };
  poll(); viewTimer = setInterval(poll, 3000);
}

// ---------- appel vidéo (WebRTC) ----------
var call = null;
function sendSignal(kind, payload) { return jsend("/api/calls/" + call.id + "/signal", "POST", { kind: kind, payload: payload }).catch(function () {}); }
function showCall(on) { $("callbox").className = "overlay" + (on ? "" : " hide"); }
async function openCall(c, caller) {
  if (call) return;
  var conf;
  try { conf = await api("/api/rtc-config"); } catch (e) { alert(e.message); return; }
  var stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
  catch (e) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e2) { alert("Autorisez le micro (et la caméra) pour appeler."); if (!caller) jsend("/api/calls/" + c.id + "/end", "POST"); return; }
  }
  var pc = new RTCPeerConnection({ iceServers: conf.iceServers });
  call = { id: c.id, pc: pc, stream: stream, since: 0, caller: caller, offered: false, pending: [], busy: false, timer: null, room: c.room };
  stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
  pc.ontrack = function (e) { $("rv").srcObject = e.streams[0]; $("callmsg").textContent = ""; };
  pc.onicecandidate = function (e) { if (e.candidate) sendSignal("ice", e.candidate.toJSON()); };
  pc.onconnectionstatechange = function () {
    if (!call) return;
    if (pc.connectionState === "connected") $("callmsg").textContent = "";
    if (pc.connectionState === "failed") $("callmsg").textContent = "Connexion impossible. Essayez l'appel de secours ci-dessous.";
  };
  $("lv").srcObject = stream; $("rv").srcObject = null;
  $("callmsg").textContent = caller ? "Appel en cours… en attente de réponse" : "Connexion…";
  $("c-alt").href = "https://meet.jit.si/" + encodeURIComponent(c.room);
  $("c-mic").textContent = "Micro"; $("c-cam").textContent = "Caméra";
  showCall(true);
  call.timer = setInterval(callTick, 1200);
}
async function callTick() {
  if (!call || call.busy) return;
  call.busy = true;
  var cur = call;
  try {
    var st = await api("/api/calls/" + cur.id);
    if (call !== cur) return;
    if (st.state === "ended") { closeCall(false, cur.caller && !cur.offered ? "Pas de réponse." : ""); return; }
    if (cur.caller && st.state === "active" && !cur.offered) {
      cur.offered = true;
      var off = await cur.pc.createOffer(); await cur.pc.setLocalDescription(off);
      await sendSignal("offer", { type: off.type, sdp: off.sdp });
    }
    var sigs = await api("/api/calls/" + cur.id + "/signals?after=" + cur.since);
    for (var i = 0; i < sigs.length; i++) {
      var s = sigs[i]; cur.since = s.id;
      if (s.kind === "offer") {
        await cur.pc.setRemoteDescription(s.payload);
        var ans = await cur.pc.createAnswer(); await cur.pc.setLocalDescription(ans);
        await sendSignal("answer", { type: ans.type, sdp: ans.sdp });
        await flushIce(cur);
      } else if (s.kind === "answer") { await cur.pc.setRemoteDescription(s.payload); await flushIce(cur); }
      else if (s.kind === "ice") {
        if (cur.pc.remoteDescription) { try { await cur.pc.addIceCandidate(s.payload); } catch (e) { /* ignore */ } } else cur.pending.push(s.payload);
      }
    }
  } catch (e) { /* on réessaie au prochain tour */ } finally { if (call === cur) cur.busy = false; }
}
async function flushIce(c) { while (c.pending.length) { try { await c.pc.addIceCandidate(c.pending.shift()); } catch (e) { /* ignore */ } } }
function closeCall(notify, text) {
  if (!call) return;
  var c = call; call = null;
  clearInterval(c.timer);
  if (notify) jsend("/api/calls/" + c.id + "/end", "POST").catch(function () {});
  c.stream.getTracks().forEach(function (t) { t.stop(); });
  try { c.pc.close(); } catch (e) { /* ignore */ }
  $("rv").srcObject = null; $("lv").srcObject = null;
  showCall(false);
  if (text) alert(text);
}
$("c-end").onclick = function () { closeCall(true); };
$("c-mic").onclick = function () { if (!call) return; var t = call.stream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; $("c-mic").textContent = t.enabled ? "Micro" : "Micro coupé"; } };
$("c-cam").onclick = function () { if (!call) return; var t = call.stream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; $("c-cam").textContent = t.enabled ? "Caméra" : "Caméra coupée"; } };


// appels entrants, messages non lus et demandes de confrères
function tickInbox() {
  if (!me) return;
  api("/api/inbox").then(function (r) {
    var changed = r.non_lus !== unread || r.demandes !== pending;
    unread = r.non_lus; pending = r.demandes || 0;
    if (changed) { nav(); renderBar(); }
    var a = r.appels[0];
    if (a && !call && shownCall !== a.id) {
      shownCall = a.id;
      $("inc-t").textContent = t("Appel vidéo de {n}", { n: a.de });
      $("incoming").className = "overlay";
      $("inc-ok").onclick = function () {
        $("incoming").className = "overlay hide";
        jsend("/api/calls/" + a.id + "/accept", "POST").then(function () { return api("/api/calls/" + a.id); }).then(function (c) { openCall(c, false); }).catch(function (e) { alert(e.message); });
      };
      $("inc-no").onclick = function () { $("incoming").className = "overlay hide"; jsend("/api/calls/" + a.id + "/end", "POST").catch(function () {}); };
    }
    if (!a) $("incoming").className = "overlay hide";
  }).catch(function () {});
}
function startInbox() { stopInbox(); tickInbox(); inboxTimer = setInterval(tickInbox, 4000); }
function stopInbox() { clearInterval(inboxTimer); inboxTimer = null; }

function loadMe() { return api("/api/me").then(function (u) { me = u; }).catch(function () { me = null; }); }
var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
function buildLangSelect() {
  var sel = $("lang"); if (!sel) return;
  sel.innerHTML = LANGS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("");
  sel.value = lang;
  sel.onchange = function () { setLang(sel.value); };
}
Promise.all([api("/api/config").then(function (c) { cfg = c; }).catch(function () {}), loadFacettes(), loadMe()]).then(function () {
  buildLangSelect(); applyLang();
  if (me) { startInbox(); syncPush(); }
  if (new URLSearchParams(location.search).get("ref")) location.hash = "#/premium";
  route();
});


// ---------- Assistant virtuel (chat public fondé sur le livre) ----------
var ast = { msgs: [], open: false, busy: false, info: null };
function astBuild() {
  if ($("ast-fab")) return;
  var logo = "/api/assistant/logo?v=" + ((ast.info && ast.info.logo) || 0);
  var fab = document.createElement("button");
  fab.id = "ast-fab"; fab.type = "button"; fab.className = "ast-fab"; fab.setAttribute("aria-label", T("Assistant virtuel"));
  fab.innerHTML = '<img alt="" src="' + logo + '"><span class="ast-lbl" translate="no">' + esc(T("Assistant virtuel")) + "</span>";
  var box = document.createElement("section");
  box.id = "ast"; box.className = "ast hide"; box.setAttribute("aria-label", T("Assistant virtuel"));
  box.innerHTML = '<header><img alt="" src="' + logo + '"><div class="grow"><b>Assistant virtuel</b><small>Répond d\'après le livre de Petit Docteur</small></div><button type="button" id="ast-x" aria-label="Fermer">×</button></header>' +
    '<div class="ast-msgs" id="ast-m" aria-live="polite"></div>' +
    '<p class="ast-note">Informations tirées d\'un livre. Elles ne remplacent pas un médecin. Urgence : allez aux urgences.</p>' +
    '<form id="ast-f"><input id="ast-q" maxlength="600" autocomplete="off" placeholder="Posez votre question…" aria-label="Votre question"><button class="pri" type="submit">Envoyer</button></form>';
  document.body.appendChild(fab); document.body.appendChild(box);
  fab.onclick = function () { astToggle(true); };
  $("ast-x").onclick = function () { astToggle(false); };
  $("ast-f").onsubmit = function (e) { e.preventDefault(); astSend(); };
  $("ast-m").onclick = function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-fiche");
    if (f) { fq = f; fcat = -1; astToggle(false); go("#/fiches"); }
  };
  astPaint();
}
function astToggle(on) {
  ast.open = on; $("ast").className = "ast" + (on ? "" : " hide"); $("ast-fab").className = "ast-fab" + (on ? " hide" : "");
  applyLang();
  if (on) { astPaint(); $("ast-q").focus(); }
}
function astPaint() {
  var m = $("ast-m"); if (!m) return;
  var h = '<div class="bub you" translate="no">' + esc(T("Bonjour, je suis l'Assistant virtuel de Petit Docteur. Posez-moi une question sur une maladie, ses causes, ses symptômes ou les remèdes du livre.")) + "</div>";
  ast.msgs.forEach(function (x) {
    h += '<div class="bub ' + (x.role === "user" ? "me" : "you") + '" translate="no">' + esc(x.content).replace(/\n/g, "<br>") + "</div>";
    if (x.fiches && x.fiches.length) h += '<div class="ast-ch">' + x.fiches.map(function (n) { return '<button type="button" class="chip" data-fiche="' + esc(n) + '">' + esc(n) + "</button>"; }).join("") + "</div>";
  });
  if (ast.busy) h += '<div class="bub you ast-wait">…</div>';
  m.innerHTML = h; m.scrollTop = m.scrollHeight;
}
function astSend() {
  var q = $("ast-q").value.trim();
  if (!q || ast.busy) return;
  $("ast-q").value = ""; ast.msgs.push({ role: "user", content: q }); ast.busy = true; astPaint();
  jsend("/api/assistant", "POST", { messages: ast.msgs.map(function (x) { return { role: x.role, content: x.content }; }), lang: lang }).then(function (r) {
    ast.msgs.push({ role: "assistant", content: r.reponse, fiches: r.fiches });
  }).catch(function (e) {
    ast.msgs.push({ role: "assistant", content: T(e.message || "L'assistant est indisponible pour le moment.") });
  }).then(function () { ast.busy = false; astPaint(); });
}
function astRebuild() {
  var was = ast.open;
  ["ast-fab", "ast"].forEach(function (i) { if ($(i)) $(i).remove(); });
  if (ast.info && ast.info.actif) { astBuild(); if (was) astToggle(true); }
}
window.astRebuild = astRebuild;
api("/api/assistant/info").then(function (i) { ast.info = i; if (i.actif) astBuild(); }).catch(function () {});

// ---------- application installable (PWA) ----------
var installEvt = null;

var iosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; if (!standalone) $("install").className = "pri"; });
window.addEventListener("appinstalled", function () { installEvt = null; $("install").className = "pri hide"; });
if (iosSafari && !standalone) $("install").className = "pri";
$("install").onclick = function () {
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(function () { installEvt = null; $("install").className = "pri hide"; }); }
  else if (iosSafari) alert("Sur iPhone : touchez le bouton Partager de Safari, puis « Sur l'écran d'accueil ».");
  else alert("Ouvrez le menu de votre navigateur (⋮) puis choisissez « Installer l'application » ou « Ajouter à l'écran d'accueil ».");
};
