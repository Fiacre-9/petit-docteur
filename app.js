"use strict";
/* Petit Docteur : application (public, patients Premium, médecins). */
var $ = function (i) { return document.getElementById(i); };
var me = null, cfg = { cats: [], price: 7000, currency: "CDF", days: 30, paiement: false };
var RL = { s: "Faible", p: "Prudence", u: "Urgence" };
var viewTimer = null, inboxTimer = null, shownCall = 0, fq = "", fcat = -1, searchTimer = null;
var isDoctorPath = location.pathname === "/medecin";

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { return Number(n).toLocaleString("fr-FR").replace(/ | /g, " ") + " " + (cfg.currency === "CDF" ? "FC" : cfg.currency); }
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
function initials(n) { return String(n || "?").split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase(); }
function avatar(u, cls) {
  var img = u.has_photo ? '<img alt="" src="/api/users/' + u.id + '/photo" onerror="this.remove()">' : "";
  return '<span class="av ' + (cls || "") + '">' + esc(initials(u.nom)) + img + "</span>";
}
function msg(el, text, ok) { el.textContent = text || ""; el.className = ok ? "ok" : "err"; }
function stopTimers() { clearInterval(viewTimer); viewTimer = null; }

// ---------- navigation ----------
function nav(badge) {
  var h = '<a href="#/">Fiches</a><a href="#/medecins">Médecins</a>';
  if (me) h += '<a href="#/messages">Messages' + (badge ? ' <span class="dot">' + badge + "</span>" : "") + "</a>";
  h += '<a href="#/compte">' + (me ? (me.role === "medecin" ? "Espace médecin" : "Mon compte") : "Connexion") + "</a>";
  $("nav").innerHTML = h;
  var cur = location.hash || "#/";
  Array.prototype.forEach.call($("nav").querySelectorAll("a"), function (a) { if (cur.indexOf(a.getAttribute("href")) === 0 && (a.getAttribute("href") !== "#/" || cur === "#/")) a.className = "on"; });
}
function go(h) { location.hash = h; }
function route() {
  stopTimers();
  var h = location.hash || (isDoctorPath ? "#/compte" : "#/");
  nav();
  if (h === "#/") return viewFiches();
  if (h === "#/medecins") return viewMedecins();
  if (h === "#/compte") return viewCompte();
  if (h === "#/premium") return viewPremium();
  if (h === "#/messages") return viewMessages();
  var m = h.match(/^#\/chat\/(\d+)$/);
  if (m) return viewChat(+m[1]);
  viewFiches();
}
window.addEventListener("hashchange", route);

// ---------- fiches ----------
function viewFiches() {
  $("view").innerHTML = '<h1>Petit Docteur</h1><p class="sub">Cherchez un mal pour voir les conseils relus par un médecin.</p>' +
    '<p class="note">Ces conseils viennent d\'un livre de médecine populaire. Ils ne remplacent pas un médecin. En cas de signe d\'alerte, consultez. En cas d\'urgence, rendez-vous aux urgences ou appelez les secours : la consultation en ligne n\'est pas faite pour les urgences.</p>' +
    '<input id="q" type="search" placeholder="Un mal, un symptôme" aria-label="Recherche" value="' + esc(fq) + '">' +
    '<div class="chips" id="cats"></div><p class="sub" id="cnt"></p><div id="list"></div>' +
    '<div id="upsell"></div>' + (cfg.whatsapp ? '<p><a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(cfg.whatsapp) + '">Écrire sur WhatsApp</a></p>' : "");
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
    }).join("") : '<p class="sub">Aucune fiche validée pour cette recherche.</p>';
    $("upsell").innerHTML = locked ? '<div class="card prem"><b>Voir toutes les fiches en détail</b><p class="sub">Symptômes complets, remèdes, consultation d\'un médecin par message et vidéo.</p>' + premiumCta() + "</div>" : "";
  }).catch(function () {});
}

// ---------- médecins ----------
function viewMedecins() {
  $("view").innerHTML = '<h1>Médecins</h1><p class="sub">Médecins vérifiés par l\'équipe. Le contact (message et vidéo) est réservé aux abonnés Premium.</p>' +
    '<input id="mq" type="search" placeholder="Nom ou spécialité" aria-label="Rechercher un médecin"><div id="docs"></div>';
  var t; $("mq").oninput = function () { clearTimeout(t); t = setTimeout(loadDocs, 250); };
  loadDocs();
}
function loadDocs() {
  api("/api/medecins?q=" + encodeURIComponent(($("mq") || {}).value || "")).then(function (l) {
    if (!$("docs")) return;
    $("docs").innerHTML = l.length ? l.map(function (d) {
      var btn = !me ? '<button data-act="login">🔒 Contacter (Premium)</button>'
        : me.role === "medecin" ? ""
        : me.premium ? '<button class="pri" data-act="chat" data-i="' + d.id + '">Contacter</button>'
        : '<button data-act="prem">🔒 Premium requis</button>';
      return '<div class="card doc">' + avatar(d, "lg") + '<div class="grow"><b>' + esc(d.nom) + '</b><br><span class="meta">' + esc(d.specialite) + (d.ville ? " · " + esc(d.ville) : "") + "</span>" +
        '<br><span class="b ' + (d.disponible ? "s" : "v") + '">' + (d.disponible ? "Disponible" : "Indisponible") + "</span>" +
        (d.bio ? '<p class="sub">' + esc(d.bio) + "</p>" : "") + btn + "</div></div>";
    }).join("") : '<p class="sub">Aucun médecin pour le moment.</p>';
  }).catch(function () {});
}
document.addEventListener("click", function (e) {
  var a = e.target.getAttribute && e.target.getAttribute("data-act");
  if (!a) return;
  if (a === "login") go("#/compte");
  if (a === "prem") go("#/premium");
  if (a === "chat") jsend("/api/conversations", "POST", { doctor_id: +e.target.getAttribute("data-i") }).then(function (c) { go("#/chat/" + c.id); }).catch(function (er) { alert(er.message); });
});

// ---------- compte ----------
function viewCompte() {
  if (!me) return viewAuth();
  if (me.role === "medecin") return viewDoctor();
  var until = me.premium_until ? new Date(me.premium_until).toLocaleDateString("fr-FR") : "";
  $("view").innerHTML = "<h1>Mon compte</h1>" +
    '<div class="card"><div class="row-s">' + avatar(me, "lg") + '<div class="grow"><b>' + esc(me.nom) + '</b><br><span class="meta">' + esc(me.telephone) + "</span></div></div>" +
    (me.premium ? '<p><span class="b s">Premium actif</span> jusqu\'au ' + esc(until) + "</p>" : '<p><span class="b v">Gratuit</span> Accès limité : aperçu des fiches, liste des médecins.</p>') +
    '<a class="btn' + (me.premium ? "" : " pri") + '" href="#/premium">' + (me.premium ? "Prolonger de 30 jours" : "Passer Premium · " + money(cfg.price) + " / mois") + "</a></div>" +
    '<div class="card"><h4 style="margin-top:0">Mon profil</h4>' + (me.premium ? profileForm(false) : '<p class="sub">🔒 Le profil complet (photo, ville, présentation) est réservé aux abonnés Premium.</p>') + "</div>" +
    '<p><button id="out">Se déconnecter</button></p>';
  bindProfile(false); $("out").onclick = logout;
}
function profileForm(doc) {
  return '<label for="pn">Nom complet</label><input id="pn" value="' + esc(me.nom) + '" autocomplete="name">' +
    (doc ? '<label for="ps">Spécialité</label><input id="ps" value="' + esc(me.specialite) + '" placeholder="Ex : Pédiatrie, Médecine générale">' : "") +
    '<label for="pv">Ville</label><input id="pv" value="' + esc(me.ville) + '">' +
    '<label for="pb">' + (doc ? "Présentation" : "À propos de moi") + '</label><textarea id="pb" rows="3" maxlength="800">' + esc(me.bio) + "</textarea>" +
    (doc ? '<label class="chk"><input type="checkbox" id="pd"' + (me.disponible ? " checked" : "") + "> Disponible pour les consultations</label>" : "") +
    '<label for="pf">Photo de profil</label><input id="pf" type="file" accept="image/*">' +
    '<button class="pri" id="psave">Enregistrer</button><p id="pm" class="err"></p>';
}
function bindProfile(doc) {
  if (!$("psave")) return;
  $("psave").onclick = function () {
    var b = { nom: $("pn").value, ville: $("pv").value, bio: $("pb").value };
    if (doc) { b.specialite = $("ps").value; b.disponible = $("pd").checked; }
    var url = doc && me.statut !== "approuve" ? "/api/me/profile-attente" : "/api/me/profile";
    jsend(url, "PUT", b).then(function () {
      var f = $("pf").files[0];
      if (!f) return;
      var fd = new FormData(); fd.append("file", f);
      return api("/api/me/photo", { method: "POST", body: fd });
    }).then(function () { return loadMe(); }).then(function () { msg($("pm"), "Profil enregistré.", true); route(); }).catch(function (e) { msg($("pm"), e.message); });
  };
}
function logout() { jsend("/api/user/logout", "POST").then(function () { me = null; stopInbox(); go("#/"); route(); }); }

function viewAuth() {
  var doc = isDoctorPath;
  $("view").innerHTML = "<h1>" + (doc ? "Espace médecin" : "Mon compte") + "</h1>" +
    (doc ? '<p class="sub">Les médecins ne paient rien. Votre numéro d\'ordre est vérifié avant l\'ouverture de votre espace.</p>' :
      '<p class="sub">Créez un compte gratuit, puis passez Premium pour l\'accès complet.</p>') +
    '<div class="tabs"><button id="t-in" class="on">Connexion</button><button id="t-up">Créer un compte</button></div>' +
    '<div class="card" id="f-in"><label for="lt">Téléphone</label><input id="lt" type="tel" autocomplete="tel" placeholder="0812345678">' +
    '<label for="lp">Mot de passe</label><input id="lp" type="password" autocomplete="current-password"><button class="pri" id="lgo">Se connecter</button><p id="lm" class="err"></p></div>' +
    '<div class="card hide" id="f-up"><label for="rn">Nom complet</label><input id="rn" autocomplete="name" placeholder="Prénom et nom">' +
    '<label for="rt">Téléphone</label><input id="rt" type="tel" autocomplete="tel" placeholder="0812345678">' +
    '<label for="rp">Mot de passe (8 caractères minimum)</label><input id="rp" type="password" autocomplete="new-password">' +
    (doc ? '<label for="rs">Spécialité</label><input id="rs" placeholder="Ex : Médecine générale"><label for="ro">Numéro d\'ordre des médecins</label><input id="ro">' : "") +
    '<label class="chk"><input type="checkbox" id="rc"> J\'accepte que mes données de santé (messages, profil) soient traitées pour les consultations. Elles ne sont lisibles que par moi et mon médecin.</label>' +
    '<button class="pri" id="rgo">Créer mon compte</button><p id="rm" class="err"></p></div>' +
    (doc ? '<p class="sub"><a href="/#/compte">Vous êtes patient ? Cliquez ici.</a></p>' : '<p class="sub"><a href="/medecin">Vous êtes médecin ? Accédez à l\'espace médecin.</a></p>');
  $("t-in").onclick = function () { $("f-in").className = "card"; $("f-up").className = "card hide"; $("t-in").className = "on"; $("t-up").className = ""; };
  $("t-up").onclick = function () { $("f-up").className = "card"; $("f-in").className = "card hide"; $("t-up").className = "on"; $("t-in").className = ""; };
  $("lgo").onclick = function () {
    jsend("/api/user/login", "POST", { telephone: $("lt").value, password: $("lp").value }).then(afterAuth).catch(function (e) { msg($("lm"), e.message); });
  };
  $("rgo").onclick = function () {
    jsend("/api/register", "POST", { nom: $("rn").value, telephone: $("rt").value, password: $("rp").value, role: doc ? "medecin" : "patient",
      specialite: doc ? $("rs").value : "", numero_ordre: doc ? $("ro").value : "", consent: $("rc").checked }).then(afterAuth).catch(function (e) { msg($("rm"), e.message); });
  };
}
function afterAuth() { return loadMe().then(function () { startInbox(); location.hash = "#/compte"; route(); }); }

// ---------- espace médecin ----------
function viewDoctor() {
  var st = me.statut;
  var banner = st === "approuve" ? '<p class="note ok-n">Compte validé : vous apparaissez dans la liste des médecins.</p>'
    : st === "refuse" ? '<p class="note bad-n">Votre inscription a été refusée. Contactez l\'administrateur.</p>'
    : '<p class="note">Votre inscription est en attente de validation. Complétez votre profil : vous serez visible dès l\'approbation.</p>';
  $("view").innerHTML = "<h1>Espace médecin</h1>" + banner +
    '<div class="card"><div class="row-s">' + avatar(me, "lg") + '<div class="grow"><b>' + esc(me.nom) + '</b><br><span class="meta">' + esc(me.specialite) + " · N° " + esc(me.numero_ordre) + "</span></div></div></div>" +
    '<div class="card"><h4 style="margin-top:0">Mon profil</h4>' + profileForm(true) + '</div><p><a class="btn" href="#/messages">Mes consultations</a> <button id="out">Se déconnecter</button></p>';
  bindProfile(true); $("out").onclick = logout;
}

// ---------- paiement Premium ----------
function viewPremium() {
  if (!me) { go("#/compte"); return; }
  if (me.role === "medecin") { go("#/compte"); return; }
  var q = new URLSearchParams(location.search), ref = q.get("ref");
  $("view").innerHTML = "<h1>Passer Premium</h1>" +
    '<div class="card prem"><p class="big">' + money(cfg.price) + " <span class=\"sub\">/ " + cfg.days + " jours</span></p><ul class=\"ticks\"><li>Fiches complètes : symptômes, remèdes, alertes</li><li>Message direct avec les médecins</li><li>Consultation vidéo</li><li>Profil avec photo</li></ul></div>" +
    (cfg.paiement ? '<div class="card"><label>Moyen de paiement</label><div class="chips"><button id="m-mob" class="on">Mobile Money</button><button id="m-card">Carte bancaire</button></div>' +
      '<div id="mobbox"><label for="pph">Numéro Mobile Money</label><input id="pph" type="tel" value="' + esc(me.telephone) + '" placeholder="0812345678"></div>' +
      '<button class="pri" id="pay">Payer ' + money(cfg.price) + '</button><p id="paym" class="err"></p></div>' :
      '<p class="note">Le paiement n\'est pas encore activé sur ce serveur.</p>');
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
      if (r.status === "paid") { stopTimers(); history.replaceState(null, "", "/#/compte"); loadMe().then(function () { alert("Paiement reçu. Votre accès Premium est actif."); go("#/compte"); route(); }); }
      else if (r.status === "failed") { stopTimers(); if ($("pay")) $("pay").disabled = false; var el = $("paym") || $("paym2"); if (el) msg(el, "Paiement non abouti. Vous pouvez réessayer."); }
    }).catch(function () {});
    if (n > 75) stopTimers();
  }, 4000);
}

// ---------- messages ----------
function viewMessages() {
  if (!me) { go("#/compte"); return; }
  $("view").innerHTML = "<h1>Messages</h1><div id=\"convs\"></div>";
  function load() {
    api("/api/conversations").then(function (l) {
      if (!$("convs")) return;
      $("convs").innerHTML = l.length ? l.map(function (c) {
        return '<a class="card doc" href="#/chat/' + c.id + '">' + avatar(c.avec, "lg") + '<div class="grow"><b>' + esc((c.avec.role === "medecin" ? "Dr " : "") + c.avec.nom) + (c.non_lus ? ' <span class="dot">' + c.non_lus + "</span>" : "") +
          '</b><br><span class="meta">' + (c.dernier ? esc(c.dernier.texte) : "Aucun message") + "</span></div></a>";
      }).join("") : '<p class="sub">' + (me.role === "patient" ? 'Aucune consultation. <a href="#/medecins">Choisissez un médecin.</a>' : "Aucune consultation pour le moment.") + "</p>";
    }).catch(function () {});
  }
  load(); viewTimer = setInterval(load, 5000);
}
function viewChat(id) {
  if (!me) { go("#/compte"); return; }
  $("view").innerHTML = '<p><a href="#/messages">← Messages</a></p><div class="card row-s" id="chead"></div><div class="chat" id="msgs" aria-live="polite"></div>' +
    '<div class="row"><input id="mt" placeholder="Votre message" maxlength="2000" aria-label="Message"><button class="pri" id="ms" style="flex:0 0 auto">Envoyer</button></div><p id="mm" class="err"></p>';
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
      if (!avec) { avec = r.avec; $("chead").innerHTML = avatar(avec, "lg") + '<div class="grow"><b>' + esc((avec.role === "medecin" ? "Dr " : "") + avec.nom) + '</b><br><span class="meta">' + esc(avec.specialite || "Patient") + '</span></div><button id="vc" class="pri">Appel vidéo</button>';
        $("vc").onclick = function () { jsend("/api/conversations/" + id + "/call", "POST").then(function (c) { openCall(c, true); }).catch(function (e) { msg($("mm"), e.message); }); }; }
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

// appels entrants et messages non lus
function startInbox() {
  stopInbox();
  var tick = function () {
    if (!me) return;
    api("/api/inbox").then(function (r) {
      nav(r.non_lus);
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
  };
  tick(); inboxTimer = setInterval(tick, 4000);
}
function stopInbox() { clearInterval(inboxTimer); inboxTimer = null; }

function loadMe() { return api("/api/me").then(function (u) { me = u; }).catch(function () { me = null; }); }
Promise.all([api("/api/config").then(function (c) { cfg = c; }).catch(function () {}), loadMe()]).then(function () {
  if (me) startInbox();
  if (new URLSearchParams(location.search).get("ref")) location.hash = "#/premium";
  route();
});

// ---------- application installable (PWA) ----------
var installEvt = null;
var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
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
