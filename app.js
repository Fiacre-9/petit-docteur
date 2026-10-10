"use strict";
/* Petit Docteur : application (public, patients Premium, médecins et réseau de confrères). */
var $ = function (i) { return document.getElementById(i); };
var me = null, cfg = { cats: [], price: 7000, currency: "CDF", days: 30, paiement: false, whatsapp: "" };
var fac = { specialites: [], villes: [], stats: {} };
var RL = { s: "Faible", p: "Prudence", u: "Urgence" };
var viewTimer = null, inboxTimer = null, shownCall = 0, fq = "", fcat = -1, searchTimer = null;
var unread = 0, pending = 0, ctab = "annuaire", curReload = null, autoCall = false;
var flt = { q: "", sp: "", vi: "", di: false };
var isDoctorPath = location.pathname === "/medecin";

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { return Number(n).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " " + (cfg.currency === "CDF" ? "FC" : cfg.currency); }
function api(p, o) {
  o = o || {}; o.credentials = "same-origin";
  return fetch(p, o).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) { var e = new Error(d.detail || "Erreur " + r.status); e.status = r.status; throw e; }
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
function msg(el, text, ok) { el.textContent = text || ""; el.className = ok ? "ok" : "err"; }
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
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>'
};
function ic(n, cls) { return '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + "</svg>"; }
function tile(color, icon, label, href, o) {
  o = o || {};
  var inner = ic(icon) + "<span>" + label + (o.sub ? "<small>" + o.sub + "</small>" : "") + "</span>" + (o.badge ? '<span class="nbadge">' + o.badge + "</span>" : "");
  if (o.act) return '<button type="button" class="tile t-' + color + '" data-act="' + o.act + '">' + inner + "</button>";
  return '<a class="tile t-' + color + (o.off ? " off" : "") + '" href="' + href + '">' + inner + "</a>";
}

// ---------- navigation et barre du haut ----------
function navItems() {
  var home = ["Accueil", "home", "#/", ["#/"]], fiches = ["Fiches", "book", "#/fiches", ["#/fiches"]];
  var docs = ["Médecins", "users", "#/medecins", ["#/medecins"]];
  var msgs = ["Messages", "chat", "#/messages", ["#/messages", "#/chat"], unread];
  if (!me) return [home, fiches, docs, ["Connexion", "user", "#/compte", ["#/compte", "#/premium"]]];
  if (isDocOk()) return [home, ["Confrères", "users", "#/confreres", ["#/confreres", "#/reseau", "#/demandes"], pending], msgs, fiches, ["Profil", "user", "#/compte", ["#/compte"]]];
  if (isDoc()) return [home, fiches, ["Profil", "user", "#/compte", ["#/compte"]]];
  return [home, fiches, docs, msgs, ["Compte", "user", "#/compte", ["#/compte", "#/premium"]]];
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
function installTile() { return standalone ? "" : tile("g", "down", "Installer l'application", "", { act: "install" }); }
function viewHome() {
  if (isDoc()) return homeDoctor();
  if (me) return homePatient();
  var s = fac.stats || {};
  var st = (s.medecins ? '<div class="stat"><b>' + s.medecins + "</b>médecins vérifiés</div>" : "") + (s.fiches ? '<div class="stat"><b>' + s.fiches + "</b>fiches relues</div>" : "") + (s.specialites ? '<div class="stat"><b>' + s.specialites + "</b>spécialités</div>" : "");
  $("view").innerHTML = '<section class="panel hero"><h1>Votre santé, avec l\'avis d\'un médecin</h1><p class="sub">Cherchez un mal pour lire des conseils relus par un médecin, trouvez un spécialiste et consultez-le en ligne par message ou en vidéo.</p>' +
    '<form id="hform" class="hsearch" role="search"><input id="hq" type="search" placeholder="Un mal, un symptôme" aria-label="Rechercher un mal"><button class="pri" type="submit">Chercher</button></form>' +
    (st ? '<div class="stats">' + st + "</div>" : "") + "</section>" +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("y", "book", "Chercher un mal", "#/fiches") + tile("b", "users", "Trouver un médecin", "#/medecins") +
    tile("t", "video", "Consulter en ligne", "#/compte", { sub: "Message et vidéo" }) +
    tile("p", "star", "Passer Premium", "#/premium", { sub: money(cfg.price) + " / mois" }) +
    tile("k", "brief", "Espace médecin", "/medecin", { sub: "Inscription gratuite" }) + installTile() + "</div></section>" +
    '<section class="panel hide" id="hdocs"><div class="panel-h"><h2>Médecins à votre service</h2><a href="#/medecins">Voir tous</a></div><div class="tl" id="hlist"></div></section>' + noteUrgence();
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
    '<dl class="kv"><dt>Abonnement</dt><dd>' + (me.premium ? "jusqu\'au " + esc(until) : "aucun") + '</dd><dt>Consultations</dt><dd id="k1">…</dd><dt>Messages non lus</dt><dd id="k2">…</dd></dl></div>' +
    '<h2 style="margin-top:16px">Activité récente</h2><div class="tl" id="act"></div></section>' +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("y", "book", "Chercher un mal", "#/fiches") + tile("b", "users", "Trouver un médecin", "#/medecins") +
    tile("t", "chat", "Mes messages", "#/messages", { badge: unread || "" }) +
    tile("p", "star", me.premium ? "Prolonger Premium" : "Passer Premium", "#/premium", { sub: money(cfg.price) + " / mois" }) +
    tile("o", "user", "Mon profil", "#/compte") + installTile() + "</div></section></div>" + noteUrgence();
  loadActivity("act", 4);
  api("/api/tableau").then(function (t) { if ($("k1")) { $("k1").textContent = t.consultations; $("k2").textContent = t.non_lus; } }).catch(function () {});
}
function homeDoctor() {
  var ok = isDocOk();
  var banner = ok ? "" : me.statut === "refuse" ? '<p class="note bad-n">Votre inscription a été refusée. Contactez l\'administrateur.</p>'
    : '<p class="note">Votre inscription est en attente de validation. Complétez votre profil : l\'annuaire des confrères, le réseau et les consultations s\'ouvrent dès l\'approbation.</p>';
  var meta = [me.specialite, me.ville].filter(Boolean).map(esc).join(" · ");
  $("view").innerHTML = banner + '<div class="split"><section class="panel"><h2>Mon espace médecin</h2><div class="inner"><div class="pro">' + avatar(me, "xl") + '<div class="grow"><h3>' + esc(drName(me.nom)) + '</h3><span class="meta">' + meta + "</span><br>" +
    '<span class="meta">N° ordre : ' + esc(me.numero_ordre) + '</span><br><span class="b ' + (ok ? "s" : me.statut === "refuse" ? "u" : "p") + '">' + (ok ? "Compte validé" : me.statut === "refuse" ? "Refusé" : "En attente") + "</span></div></div>" +
    '<div class="actions"><a class="ab" href="#/messages"><span class="c">' + ic("chat") + "</span>Messages" + (unread ? '<span class="nbadge">' + unread + "</span>" : "") + "</a>" +
    '<a class="ab" href="#/confreres"><span class="c">' + ic("users") + "</span>Confrères</a>" +
    '<a class="ab" href="#/demandes"><span class="c">' + ic("userplus") + "</span>Demandes" + (pending ? '<span class="nbadge">' + pending + "</span>" : "") + "</a>" +
    '<a class="ab" href="#/compte"><span class="c">' + ic("user") + "</span>Profil</a></div>" +
    '<dl class="kv"><dt>Consultations</dt><dd id="k1">…</dd><dt>Confrères connectés</dt><dd id="k2">…</dd><dt>Demandes en attente</dt><dd id="k3">…</dd></dl></div>' +
    (ok ? '<h2 style="margin-top:16px">Activité récente</h2><div class="tl" id="act"></div>' : "") + "</section>" +
    '<section class="panel"><h2>Que souhaitez-vous faire ?</h2><div class="tiles">' +
    tile("t", "chat", "Mes consultations", "#/messages", { badge: unread || "", off: !ok }) +
    tile("b", "users", "Trouver des confrères", "#/confreres", { off: !ok }) +
    tile("p", "userplus", "Demandes reçues", "#/demandes", { badge: pending || "", off: !ok }) +
    tile("g", "usercheck", "Mon réseau", "#/reseau", { off: !ok }) +
    tile("o", "user", "Compléter mon profil", "#/compte") + tile("y", "book", "Fiches santé", "#/fiches") + installTile() + "</div></section></div>";
  if (ok) loadActivity("act", 4);
  api("/api/tableau").then(function (t) { if ($("k1")) { $("k1").textContent = t.consultations; $("k2").textContent = t.confreres; $("k3").textContent = t.demandes; } }).catch(function () {});
}

// ---------- fiches ----------
function viewFiches() {
  $("view").innerHTML = '<section class="panel"><h1>Fiches santé</h1><p class="sub">Cherchez un mal pour voir les conseils relus par un médecin.</p>' + noteUrgence() +
    '<input id="q" type="search" placeholder="Un mal, un symptôme" aria-label="Recherche" value="' + esc(fq) + '">' +
    '<div class="chips" id="cats"></div><p class="sub" id="cnt"></p><div class="fl" id="list"></div><div id="upsell"></div>' +
    (cfg.whatsapp ? '<p><a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(cfg.whatsapp) + '">Écrire sur WhatsApp</a></p>' : "") + "</section>";
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
  return me ? (me.role === "patient" ? '<a class="btn" href="#/premium">Passer Premium · ' + money(cfg.price) + " / mois</a>" : "")
    : '<a class="btn" href="#/compte">Créer un compte ou se connecter</a>';
}
function loadFiches() {
  api("/api/fiches?q=" + encodeURIComponent(fq) + "&cat=" + fcat).then(function (l) {
    if (!$("list")) return;
    $("cnt").textContent = l.length + " fiche(s)";
    var locked = l.some(function (r) { return r.locked; });
    $("list").innerHTML = l.length ? l.map(function (r) {
      return '<div class="card"><details><summary><span>' + esc(r.nom) + '<br><span class="meta">' + esc(cfg.cats[r.cat]) + '</span></span><span class="b ' + r.risque + '">' + RL[r.risque] + "</span></summary>" +
        "<h4>Symptômes</h4><p>" + esc(r.symptomes) + "</p><h4>Remède du livre</h4><p>" + esc(r.remedes) + "</p>" +
        (r.alerte ? '<div class="al"><b>Alerte :</b> ' + esc(r.alerte) + "</div>" : "") +
        (r.locked ? '<div class="lock">🔒 Aperçu limité. Le détail complet est réservé aux abonnés Premium.</div>' : "") + "</details></div>";
    }).join("") : '<div class="empty">' + ic("search") + '<p>Aucune fiche validée pour cette recherche.</p></div>';
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
    '<div><span class="b ' + (d.disponible ? "s" : "v") + '">' + (d.disponible ? "Disponible" : "Indisponible") + "</span>" + (d.experience ? '<span class="b v">' + d.experience + " ans d'expérience</span>" : "") + "</div>" +
    (d.bio ? '<p class="bio">' + esc(d.bio) + "</p>" : "") + (actions ? '<div class="pact">' + actions + "</div>" : "") + "</div></article>";
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
    '<a class="btn' + (me.premium ? "" : " pri") + '" href="#/premium">' + (me.premium ? "Prolonger de 30 jours" : "Passer Premium · " + money(cfg.price) + " / mois") + "</a> " + '<button id="out" type="button">' + ic("out") + "Se déconnecter</button></div>" +
    '<div class="inner"><h2>Mon profil</h2>' + (me.premium ? profileForm(false) : '<p class="sub">🔒 Le profil complet (photo, ville, présentation) est réservé aux abonnés Premium.</p>') + "</div></div></section>";
  bindProfile(false); $("out").onclick = logout;
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
function logout() { jsend("/api/user/logout", "POST").then(function () { me = null; unread = 0; pending = 0; stopInbox(); go("#/"); }); }

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
    '<label class="chk"><input type="checkbox" id="rc"> J\'accepte que mes données de santé (messages, profil) soient traitées pour les consultations. Elles ne sont lisibles que par moi et mon médecin.</label>' +
    '<button class="pri" id="rgo">Créer mon compte</button><p id="rm" class="err"></p></div></div></div></section>';
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
function afterAuth() { return loadMe().then(function () { startInbox(); if (location.hash === "#/") route(); else location.hash = "#/"; }); }

// ---------- profil du médecin ----------
function viewDoctor() {
  var st = me.statut;
  var banner = st === "approuve" ? '<p class="note ok-n">Compte validé : vous apparaissez dans la liste des médecins et dans l\'annuaire des confrères.</p>'
    : st === "refuse" ? '<p class="note bad-n">Votre inscription a été refusée. Contactez l\'administrateur.</p>'
    : '<p class="note">Votre inscription est en attente de validation. Complétez votre profil : vous serez visible dès l\'approbation.</p>';
  $("view").innerHTML = '<section class="panel"><h1>Mon profil</h1>' + banner + '<div class="split"><div><p class="sub">Voici comment les autres vous voient.</p>' + pcard(me, "") +
    '<p style="margin-top:12px"><button id="out" type="button">' + ic("out") + "Se déconnecter</button></p></div>" +
    '<div class="inner"><h2>Modifier mon profil</h2>' + profileForm(true) + "</div></div></section>";
  bindProfile(true); $("out").onclick = logout;
}

// ---------- paiement Premium ----------
function viewPremium() {
  if (!me) { go("#/compte"); return; }
  if (me.role === "medecin") { go("#/compte"); return; }
  var q = new URLSearchParams(location.search), ref = q.get("ref");
  $("view").innerHTML = '<section class="panel"><h1>Passer Premium</h1><div class="split"><div class="inner prem"><p class="big">' + money(cfg.price) + ' <span class="sub">/ ' + cfg.days + ' jours</span></p><ul class="ticks"><li>Fiches complètes : symptômes, remèdes, alertes</li><li>Message direct avec les médecins</li><li>Consultation vidéo</li><li>Profil avec photo</li></ul></div>' +
    (cfg.paiement ? '<div class="inner"><label>Moyen de paiement</label><div class="chips"><button id="m-mob" class="on">Mobile Money</button><button id="m-card">Carte bancaire</button></div>' +
      '<div id="mobbox"><label for="pph">Numéro Mobile Money</label><input id="pph" type="tel" value="' + esc(me.telephone) + '" placeholder="0812345678"></div>' +
      '<button class="pri" id="pay">Payer ' + money(cfg.price) + '</button><p id="paym" class="err"></p></div>' :
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
      var d = document.createElement("div"); d.className = "bub " + (m.from_id === me.id ? "me" : "you");
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
      $("inc-t").textContent = "Appel vidéo de " + a.de;
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
Promise.all([api("/api/config").then(function (c) { cfg = c; }).catch(function () {}), loadFacettes(), loadMe()]).then(function () {
  if (me) startInbox();
  if (new URLSearchParams(location.search).get("ref")) location.hash = "#/premium";
  route();
});


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
