"use strict";
/* Petit Docteur : serveur Node.js (Express + SQLite intégré à Node).
   - Public : recherche limitée (aperçu), liste des médecins sans contact.
   - Abonnés Premium (7 000 FC / mois via FlexPaie) : fiches complètes, profil, messagerie et appel vidéo avec les médecins.
   - Médecins : espace dédié (profil, photo, spécialité), validés par l'administrateur.
   - Admin : lecture de pages par Claude, validation des fiches, validation des médecins, abonnés. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { DatabaseSync } = require("node:sqlite");
const flexpay = require(fs.existsSync(path.join(__dirname, "lib", "flexpay.js")) ? "./lib/flexpay" : "./flexpay");
const remedes = require(fs.existsSync(path.join(__dirname, "lib", "remedes.js")) ? "./lib/remedes" : "./remedes");
let webpush = null;
try { webpush = require("web-push"); } catch (e) { console.warn("web-push absent : notifications désactivées"); }
let sharp = null;
try { sharp = require("sharp"); } catch (e) { console.warn("sharp indisponible : images enregistrées sans redimensionnement"); }

const SECRET = process.env.SECRET_KEY || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const WHATSAPP = String(process.env.WHATSAPP_NUMBER || "243861375050").replace(/\D/g, "");
const COOKIE_SECURE = (process.env.COOKIE_SECURE || "1") === "1";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(os.homedir(), "petit-docteur-data"));
const IMG_DIR = path.join(DATA_DIR, "images");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE || 7000);
const PREMIUM_CURRENCY = process.env.PREMIUM_CURRENCY || "CDF";
const PREMIUM_DAYS = 30;
const SESSION_HOURS = 12;
const USER_SESSION_DAYS = 30;
const MAX_UPLOAD = 15 * 1024 * 1024;

if (SECRET.length < 32 || ADMIN_PASSWORD.length < 10) {
  console.error("Définissez SECRET_KEY (32 caractères minimum) et ADMIN_PASSWORD (10 minimum).");
  process.exit(1);
}
if (!flexpay.configured()) console.warn("FLEXPAY_TOKEN manquant : le paiement Premium est désactivé.");

const CATS = ["Peau & visage", "Premiers secours", "Digestion & foie", "Circulation & cœur",
  "Articulations", "Autres", "Thyroïde & métabolisme"];
const DEFAULT_TASKS = ["Relire les fiches à valider", "Lire et enregistrer les pages photographiées aujourd'hui",
  "Faire relire les fiches à risque par un médecin", "Valider les médecins en attente"];

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const REMEDE_DIR = path.join(DATA_DIR, "remedes");
fs.mkdirSync(REMEDE_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "petit_docteur.db"));

// heure de Kinshasa (UTC+1)
const now = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 19);
const today = () => now().slice(0, 10);

db.exec(`
CREATE TABLE IF NOT EXISTS fiches(id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL,
  source TEXT DEFAULT '', page TEXT DEFAULT '', cat INTEGER DEFAULT 5, risque TEXT DEFAULT 'p',
  symptomes TEXT DEFAULT '', remedes TEXT DEFAULT '', alerte TEXT DEFAULT '', image TEXT DEFAULT '',
  valide INTEGER DEFAULT 0, valide_par TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, texte TEXT);
CREATE TABLE IF NOT EXISTS taches(id INTEGER PRIMARY KEY AUTOINCREMENT, jour TEXT, texte TEXT, fait INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, telephone TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'patient', statut TEXT NOT NULL DEFAULT 'actif',
  specialite TEXT DEFAULT '', numero_ordre TEXT DEFAULT '', ville TEXT DEFAULT '', bio TEXT DEFAULT '',
  photo TEXT DEFAULT '', disponible INTEGER DEFAULT 1, premium_until INTEGER DEFAULT 0,
  consent_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL, created_at TEXT, UNIQUE(patient_id, doctor_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, from_id INTEGER NOT NULL,
  texte TEXT NOT NULL, ts TEXT, lu INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, started_by INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'ringing', room TEXT, created_ms INTEGER, updated_ms INTEGER);
CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER NOT NULL, from_id INTEGER NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL, created_ms INTEGER);
CREATE INDEX IF NOT EXISTS idx_sig_call ON signals(call_id, id);
CREATE TABLE IF NOT EXISTS orders(ref TEXT PRIMARY KEY, user_id INTEGER NOT NULL, method TEXT, phone TEXT,
  amount INTEGER, currency TEXT, status TEXT DEFAULT 'pending', order_number TEXT, created_ms INTEGER, paid_ms INTEGER);
`);
// colonnes ajoutées après la première version (ignorées si elles existent déjà)
for (const col of ["cabinet TEXT DEFAULT ''", "langues TEXT DEFAULT ''", "experience INTEGER DEFAULT 0"]) {
  try { db.exec("ALTER TABLE users ADD COLUMN " + col); } catch (e) { /* déjà présente */ }
}
for (const col of ["causes TEXT DEFAULT ''", "consequences TEXT DEFAULT ''"]) {
  try { db.exec("ALTER TABLE fiches ADD COLUMN " + col); } catch (e) { /* déjà présente */ }
}
db.exec(`
CREATE TABLE IF NOT EXISTS fiche_images(id INTEGER PRIMARY KEY AUTOINCREMENT, fiche_id INTEGER NOT NULL, terme TEXT DEFAULT '',
  titre TEXT DEFAULT '', source_url TEXT DEFAULT '', auteur TEXT DEFAULT '', licence TEXT DEFAULT '', licence_url TEXT DEFAULT '',
  fichier TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'propose', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_fimg ON fiche_images(fiche_id, statut);
CREATE TABLE IF NOT EXISTS push_subs(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, lang TEXT DEFAULT 'fr', created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS connexions(id INTEGER PRIMARY KEY AUTOINCREMENT, de_id INTEGER NOT NULL, vers_id INTEGER NOT NULL,
  statut TEXT NOT NULL DEFAULT 'attente', created_at TEXT, UNIQUE(de_id, vers_id));
CREATE INDEX IF NOT EXISTS idx_cx_vers ON connexions(vers_id, statut);
`);
const log = (texte) => db.prepare("INSERT INTO journal(ts,texte) VALUES(?,?)").run(now(), texte);

const seedFile = path.join(__dirname, "seed.json");
if (fs.existsSync(seedFile) && db.prepare("SELECT COUNT(*) c FROM fiches").get().c === 0) {
  const ins = db.prepare("INSERT INTO fiches(nom,source,page,cat,risque,symptomes,remedes,alerte,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (const f of JSON.parse(fs.readFileSync(seedFile, "utf8")))
    ins.run(f.nom, f.source, f.page, f.cat, f.risque, f.symptomes, f.remedes, f.alerte, now(), now());
  log("Fiches de départ importées (à valider)");
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self)" });
  next();
});

// ---------- outils ----------
const baseUrl = (req) => BASE_URL || `${req.protocol}://${req.get("host")}`;
const hits = new Map();
const rateLimit = (max, windowMs) => (req, res, next) => {
  const k = req.ip + req.path, t = Date.now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) return res.status(429).json({ detail: "Trop de tentatives, réessayez dans un instant." });
  arr.push(t); hits.set(k, arr); next();
};
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

function normalizePhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (/^243\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return "243" + d.slice(1);
  if (/^\d{9}$/.test(d)) return "243" + d;
  return null;
}
const sign = (scope, p) => crypto.createHmac("sha256", SECRET).update(scope + ":" + p).digest("hex");
const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken(scope, subject, hours) {
  const p = `${subject}|${Math.floor(Date.now() / 1000) + hours * 3600}`;
  return Buffer.from(p).toString("base64url") + "." + sign(scope, p);
}
function readToken(scope, tok) {
  try {
    const i = tok.lastIndexOf(".");
    const p = Buffer.from(tok.slice(0, i), "base64url").toString();
    const sig = tok.slice(i + 1);
    const exp = parseInt(p.slice(p.lastIndexOf("|") + 1), 10);
    if (sig.length === 64 && safeEq(sig, sign(scope, p)) && exp > Date.now() / 1000) return p.slice(0, p.lastIndexOf("|"));
  } catch (e) { /* ignore */ }
  return null;
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
  const i = c.indexOf("="); return i < 0 ? ["", ""] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
}));
const clip = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const years = (v) => Math.max(0, Math.min(70, parseInt(v, 10) || 0));

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return h.length === hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

// ---------- connexion administrateur ----------
const needAdmin = (req, res, next) => {
  if (readToken("adm", cookies(req).pd_session || "") !== ADMIN_USER) return res.status(401).json({ detail: "Connexion requise" });
  next();
};
const attempts = new Map();
app.post("/api/login", (req, res) => {
  const ip = req.ip || "?";
  let [n, t0] = attempts.get(ip) || [0, Date.now()];
  if (Date.now() - t0 > 600e3) { n = 0; t0 = Date.now(); }
  if (n >= 5) return res.status(429).json({ detail: "Trop d'essais. Réessayez dans 10 minutes." });
  attempts.set(ip, [n + 1, t0]);
  const { user = "", password = "" } = req.body || {};
  if (!(safeEq(user, ADMIN_USER) && safeEq(password, ADMIN_PASSWORD)))
    return res.status(401).json({ detail: "Identifiants incorrects" });
  attempts.delete(ip);
  res.cookie("pd_session", makeToken("adm", ADMIN_USER, SESSION_HOURS), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict", maxAge: SESSION_HOURS * 3600e3 });
  log("Connexion administrateur");
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { res.clearCookie("pd_session"); res.json({ ok: true }); });

// ---------- comptes utilisateurs (patients et médecins) ----------
const isPremium = (u) => u.role === "medecin" ? u.statut === "approuve" : u.premium_until > Date.now();
function publicUser(u) {
  return { id: u.id, nom: u.nom, telephone: u.telephone, role: u.role, statut: u.statut, specialite: u.specialite,
    numero_ordre: u.numero_ordre, ville: u.ville, bio: u.bio, cabinet: u.cabinet || "", langues: u.langues || "",
    experience: u.experience || 0, has_photo: !!u.photo, disponible: !!u.disponible,
    premium: isPremium(u), premium_until: u.premium_until || 0 };
}
function userFromReq(req) {
  const id = parseInt(readToken("usr", cookies(req).pd_user || ""), 10);
  return id ? db.prepare("SELECT * FROM users WHERE id=?").get(id) : null;
}
const optUser = (req, res, next) => { req.user = userFromReq(req); next(); };
const needUser = (req, res, next) => {
  req.user = userFromReq(req);
  if (!req.user) return res.status(401).json({ detail: "Connectez-vous pour continuer." });
  next();
};
const needPremium = (req, res, next) => {
  if (!isPremium(req.user)) return res.status(402).json({ detail: req.user.role === "medecin"
    ? "Votre compte médecin n'est pas encore validé par l'administrateur." : "Cette fonction est réservée aux abonnés Premium." });
  next();
};
function setUserCookie(res, uid) {
  res.cookie("pd_user", makeToken("usr", uid, USER_SESSION_DAYS * 24), { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: USER_SESSION_DAYS * 86400e3 });
}

app.post("/api/register", rateLimit(8, 10 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const nom = clip(b.nom, 120), tel = normalizePhone(b.telephone), pw = String(b.password || "");
  const role = b.role === "medecin" ? "medecin" : "patient";
  if (nom.length < 3 || !nom.includes(" ")) return res.status(400).json({ detail: "Indiquez votre nom complet (prénom et nom)." });
  if (!tel) return res.status(400).json({ detail: "Numéro de téléphone invalide. Exemple : 0812345678" });
  if (pw.length < 8) return res.status(400).json({ detail: "Le mot de passe doit avoir au moins 8 caractères." });
  if (!b.consent) return res.status(400).json({ detail: "Vous devez accepter le traitement de vos données de santé." });
  const specialite = clip(b.specialite, 100), numero = clip(b.numero_ordre, 60);
  if (role === "medecin" && (!specialite || !numero)) return res.status(400).json({ detail: "Spécialité et numéro d'ordre des médecins obligatoires." });
  if (db.prepare("SELECT 1 x FROM users WHERE telephone=?").get(tel)) return res.status(409).json({ detail: "Ce numéro a déjà un compte. Connectez-vous." });
  const r = db.prepare("INSERT INTO users(nom,telephone,pass,role,statut,specialite,numero_ordre,consent_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(nom, tel, hashPassword(pw), role, role === "medecin" ? "attente" : "actif", specialite, numero, now(), now());
  log(role === "medecin" ? `Médecin inscrit (à valider) : ${nom}` : `Nouveau compte : ${nom}`);
  setUserCookie(res, Number(r.lastInsertRowid));
  res.json({ ok: true });
});
app.post("/api/user/login", rateLimit(10, 10 * 60 * 1000), (req, res) => {
  const tel = normalizePhone((req.body || {}).telephone), pw = String((req.body || {}).password || "");
  const u = tel && db.prepare("SELECT * FROM users WHERE telephone=?").get(tel);
  if (!u || !checkPassword(pw, u.pass)) return res.status(401).json({ detail: "Numéro ou mot de passe incorrect." });
  setUserCookie(res, u.id);
  res.json({ ok: true });
});
app.post("/api/user/logout", (req, res) => { res.clearCookie("pd_user"); res.json({ ok: true }); });
app.get("/api/me", optUser, (req, res) => res.json(req.user ? publicUser(req.user) : null));

// suppression du compte (exigée par les boutiques d'applications) : tout ce qui concerne la personne est effacé,
// sauf les reçus de paiement, conservés sans lien avec un nom
app.delete("/api/me", needUser, rateLimit(5, 10 * 60e3), (req, res) => {
  const u = req.user;
  if (!checkPassword(String((req.body || {}).password || ""), u.pass)) return res.status(403).json({ detail: "Mot de passe incorrect." });
  db.exec("BEGIN");
  try {
    for (const c of db.prepare("SELECT id FROM conversations WHERE patient_id=? OR doctor_id=?").all(u.id, u.id)) {
      db.prepare("DELETE FROM signals WHERE call_id IN (SELECT id FROM calls WHERE conv_id=?)").run(c.id);
      db.prepare("DELETE FROM calls WHERE conv_id=?").run(c.id);
      db.prepare("DELETE FROM messages WHERE conv_id=?").run(c.id);
      db.prepare("DELETE FROM conversations WHERE id=?").run(c.id);
    }
    db.prepare("DELETE FROM connexions WHERE de_id=? OR vers_id=?").run(u.id, u.id);
    db.prepare("DELETE FROM push_subs WHERE user_id=?").run(u.id);
    db.prepare("DELETE FROM users WHERE id=?").run(u.id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); return res.status(500).json({ detail: "Suppression impossible, réessayez." }); }
  if (u.photo) fs.rmSync(path.join(AVATAR_DIR, path.basename(u.photo)), { force: true });
  log(`Compte supprimé à la demande de la personne : ${u.nom}`);
  res.clearCookie("pd_user");
  res.json({ ok: true });
});
app.put("/api/me/profile", needUser, needPremium, (req, res) => {
  const b = req.body || {}, u = req.user;
  const nom = clip(b.nom, 120);
  if (nom.length < 3 || !nom.includes(" ")) return res.status(400).json({ detail: "Indiquez votre nom complet (prénom et nom)." });
  if (u.role === "medecin") {
    const sp = clip(b.specialite, 100);
    if (!sp) return res.status(400).json({ detail: "La spécialité est obligatoire." });
    db.prepare("UPDATE users SET nom=?,specialite=?,bio=?,ville=?,disponible=?,cabinet=?,langues=?,experience=? WHERE id=?")
      .run(nom, sp, clip(b.bio, 800), clip(b.ville, 80), b.disponible ? 1 : 0, clip(b.cabinet, 120), clip(b.langues, 100), years(b.experience), u.id);
  } else {
    db.prepare("UPDATE users SET nom=?,bio=?,ville=? WHERE id=?").run(nom, clip(b.bio, 800), clip(b.ville, 80), u.id);
  }
  res.json({ ok: true });
});
// un médecin en attente de validation peut déjà compléter son profil
app.put("/api/me/profile-attente", needUser, (req, res) => {
  const u = req.user, b = req.body || {};
  if (u.role !== "medecin") return res.status(403).json({ detail: "Réservé aux médecins." });
  const nom = clip(b.nom, 120), sp = clip(b.specialite, 100);
  if (nom.length < 3 || !nom.includes(" ") || !sp) return res.status(400).json({ detail: "Nom complet et spécialité obligatoires." });
  db.prepare("UPDATE users SET nom=?,specialite=?,bio=?,ville=?,disponible=?,cabinet=?,langues=?,experience=? WHERE id=?")
    .run(nom, sp, clip(b.bio, 800), clip(b.ville, 80), b.disponible ? 1 : 0, clip(b.cabinet, 120), clip(b.langues, 100), years(b.experience), u.id);
  res.json({ ok: true });
});

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.post("/api/me/photo", needUser, (req, res) => {
  const u = req.user;
  if (u.role !== "medecin" && !isPremium(u)) return res.status(402).json({ detail: "La photo de profil est réservée aux abonnés Premium." });
  avatarUpload.single("file")(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ detail: "Photo trop lourde (8 Mo maximum) ou illisible." });
    try {
      if (!sharp) throw new Error("no sharp");
      const jpeg = await sharp(req.file.buffer).rotate().resize(480, 480, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
      const name = `${u.id}-${crypto.randomBytes(4).toString("hex")}.jpg`;
      fs.writeFileSync(path.join(AVATAR_DIR, name), jpeg);
      if (u.photo) fs.rmSync(path.join(AVATAR_DIR, path.basename(u.photo)), { force: true });
      db.prepare("UPDATE users SET photo=? WHERE id=?").run(name, u.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ detail: "Ce fichier n'est pas une image lisible." }); }
  });
});
// photo : publique pour les médecins validés ; sinon moi-même ou mon interlocuteur
app.get("/api/users/:id/photo", optUser, (req, res) => {
  const t = db.prepare("SELECT id,role,statut,photo FROM users WHERE id=?").get(req.params.id);
  if (!t || !t.photo) return res.sendStatus(404);
  const me = req.user;
  const ok = (t.role === "medecin" && t.statut === "approuve") || (me && (me.id === t.id ||
    db.prepare("SELECT 1 x FROM conversations WHERE (patient_id=? AND doctor_id=?) OR (patient_id=? AND doctor_id=?)").get(me.id, t.id, t.id, me.id)));
  if (!ok) return res.sendStatus(404);
  res.set("Cache-Control", "private, max-age=300").type("image/jpeg").sendFile(path.join(AVATAR_DIR, path.basename(t.photo)));
});

// ---------- médecins (liste visible par tous, contact réservé) ----------
const DOC_COLS = "id,nom,specialite,ville,bio,cabinet,langues,experience,disponible,(photo<>'') has_photo";
// filtres communs à l'annuaire public et à l'annuaire des confrères
function docFilter(req, exceptId) {
  let sql = " FROM users WHERE role='medecin' AND statut='approuve'";
  const args = [];
  if (exceptId) { sql += " AND id<>?"; args.push(exceptId); }
  const q = clip(req.query.q, 80), sp = clip(req.query.specialite, 100), vi = clip(req.query.ville, 80);
  if (q) { sql += " AND (nom LIKE ? OR specialite LIKE ? OR ville LIKE ? OR cabinet LIKE ?)"; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (sp) { sql += " AND specialite = ? COLLATE NOCASE"; args.push(sp); }
  if (vi) { sql += " AND ville = ? COLLATE NOCASE"; args.push(vi); }
  if (req.query.dispo === "1") sql += " AND disponible=1";
  return { sql, args };
}
app.get("/api/medecins", (req, res) => {
  const f = docFilter(req);
  res.json(db.prepare("SELECT " + DOC_COLS + f.sql + " ORDER BY disponible DESC, nom LIMIT 200").all(...f.args)
    .map((d) => ({ ...d, bio: d.bio.slice(0, 240) })));
});
// listes pour les filtres et chiffres de l'accueil (publics, sans donnée personnelle)
app.get("/api/facettes", (req, res) => {
  const one = (sql) => db.prepare(sql).all().map((r) => r.v);
  res.json({
    specialites: one("SELECT DISTINCT specialite v FROM users WHERE role='medecin' AND statut='approuve' AND specialite<>'' ORDER BY specialite COLLATE NOCASE"),
    villes: one("SELECT DISTINCT ville v FROM users WHERE role='medecin' AND statut='approuve' AND ville<>'' ORDER BY ville COLLATE NOCASE"),
    stats: {
      medecins: db.prepare("SELECT COUNT(*) n FROM users WHERE role='medecin' AND statut='approuve'").get().n,
      fiches: db.prepare("SELECT COUNT(*) n FROM fiches WHERE valide=1").get().n,
      specialites: db.prepare("SELECT COUNT(DISTINCT specialite COLLATE NOCASE) n FROM users WHERE role='medecin' AND statut='approuve' AND specialite<>''").get().n,
    },
  });
});

// ---------- réseau entre médecins : annuaire des confrères, demandes, contacts ----------
const needDoctor = (req, res, next) => {
  if (req.user.role !== "medecin" || req.user.statut !== "approuve")
    return res.status(403).json({ detail: "Réservé aux médecins dont le compte est validé." });
  next();
};
const linkBetween = (a, b) => db.prepare("SELECT * FROM connexions WHERE (de_id=? AND vers_id=?) OR (de_id=? AND vers_id=?)").get(a, b, b, a);
const linkState = (l, me) => (!l ? "aucune" : l.statut === "accepte" ? "connecte" : l.de_id === me ? "envoyee" : "recue");
const approvedDoctor = (id) => db.prepare("SELECT id FROM users WHERE id=? AND role='medecin' AND statut='approuve'").get(parseInt(id, 10));

app.get("/api/confreres", needUser, needDoctor, (req, res) => {
  const f = docFilter(req, req.user.id);
  const links = new Map();
  for (const l of db.prepare("SELECT * FROM connexions WHERE de_id=? OR vers_id=?").all(req.user.id, req.user.id))
    links.set(l.de_id === req.user.id ? l.vers_id : l.de_id, l);
  res.json(db.prepare("SELECT " + DOC_COLS + f.sql + " ORDER BY disponible DESC, nom LIMIT 200").all(...f.args)
    .map((d) => ({ ...d, bio: d.bio.slice(0, 400), etat: linkState(links.get(d.id), req.user.id) })));
});
app.get("/api/reseau", needUser, needDoctor, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare("SELECT c.de_id,c.vers_id,c.statut,u.id,u.nom,u.specialite,u.ville,u.bio,u.cabinet,u.langues,u.experience,u.disponible,(u.photo<>'') has_photo " +
    "FROM connexions c JOIN users u ON u.id = CASE WHEN c.de_id=? THEN c.vers_id ELSE c.de_id END " +
    "WHERE (c.de_id=? OR c.vers_id=?) AND u.role='medecin' AND u.statut='approuve' ORDER BY u.nom").all(me, me, me);
  const out = { connectes: [], recues: [], envoyees: [] };
  for (const r of rows) {
    const d = { id: r.id, nom: r.nom, specialite: r.specialite, ville: r.ville, bio: r.bio.slice(0, 400), cabinet: r.cabinet, langues: r.langues,
      experience: r.experience, disponible: r.disponible, has_photo: r.has_photo };
    if (r.statut === "accepte") out.connectes.push({ ...d, etat: "connecte" });
    else if (r.de_id === me) out.envoyees.push({ ...d, etat: "envoyee" });
    else out.recues.push({ ...d, etat: "recue" });
  }
  res.json(out);
});
app.post("/api/confreres/:id/connect", needUser, needDoctor, rateLimit(40, 60e3), (req, res) => {
  const me = req.user.id, t = approvedDoctor(req.params.id);
  if (!t || t.id === me) return res.status(404).json({ detail: "Confrère introuvable." });
  const l = linkBetween(me, t.id);
  if (!l) {
    db.prepare("INSERT INTO connexions(de_id,vers_id,statut,created_at) VALUES(?,?,'attente',?)").run(me, t.id, now());
    notify(t.id, "req", req.user.nom, "/#/demandes");
    return res.json({ etat: "envoyee" });
  }
  // il m'avait déjà écrit : la demande croisée vaut acceptation
  if (l.statut === "attente" && l.de_id === t.id) {
    db.prepare("UPDATE connexions SET statut='accepte' WHERE id=?").run(l.id);
    return res.json({ etat: "connecte" });
  }
  res.json({ etat: linkState(l, me) });
});
app.post("/api/confreres/:id/accept", needUser, needDoctor, (req, res) => {
  const r = db.prepare("UPDATE connexions SET statut='accepte' WHERE de_id=? AND vers_id=? AND statut='attente'").run(parseInt(req.params.id, 10), req.user.id);
  if (!r.changes) return res.status(404).json({ detail: "Demande introuvable." });
  notify(parseInt(req.params.id, 10), "acc", req.user.nom, "/#/reseau");
  res.json({ etat: "connecte" });
});
// annuler une demande envoyée, refuser une demande reçue ou retirer un confrère
app.delete("/api/confreres/:id", needUser, needDoctor, (req, res) => {
  const l = linkBetween(req.user.id, parseInt(req.params.id, 10));
  if (l) db.prepare("DELETE FROM connexions WHERE id=?").run(l.id);
  res.json({ etat: "aucune" });
});
app.post("/api/confreres/:id/conversation", needUser, needDoctor, (req, res) => {
  const me = req.user.id, t = approvedDoctor(req.params.id);
  if (!t || t.id === me) return res.status(404).json({ detail: "Confrère introuvable." });
  const l = linkBetween(me, t.id);
  if (!l || l.statut !== "accepte") return res.status(403).json({ detail: "Connectez-vous d'abord : votre confrère doit accepter votre demande." });
  let c = db.prepare("SELECT id FROM conversations WHERE (patient_id=? AND doctor_id=?) OR (patient_id=? AND doctor_id=?)").get(me, t.id, t.id, me);
  if (!c) {
    const r = db.prepare("INSERT INTO conversations(patient_id,doctor_id,created_at) VALUES(?,?,?)").run(Math.min(me, t.id), Math.max(me, t.id), now());
    c = { id: Number(r.lastInsertRowid) };
  }
  res.json({ id: c.id });
});
// entre deux médecins, on écrit et on appelle seulement si la connexion est acceptée
function docPairBlocked(c) {
  const a = db.prepare("SELECT role FROM users WHERE id=?").get(c.patient_id), b = db.prepare("SELECT role FROM users WHERE id=?").get(c.doctor_id);
  if (!a || !b || a.role !== "medecin" || b.role !== "medecin") return false;
  const l = linkBetween(c.patient_id, c.doctor_id);
  return !l || l.statut !== "accepte";
}

// chiffres du tableau de bord
app.get("/api/tableau", needUser, (req, res) => {
  const u = req.user;
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const out = { non_lus: n("SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conv_id WHERE (c.patient_id=? OR c.doctor_id=?) AND m.from_id<>? AND m.lu=0", u.id, u.id, u.id) };
  if (u.role === "medecin") {
    out.consultations = n("SELECT COUNT(*) n FROM conversations c JOIN users p ON p.id=c.patient_id WHERE c.doctor_id=? AND p.role='patient'", u.id);
    out.confreres = n("SELECT COUNT(*) n FROM connexions WHERE (de_id=? OR vers_id=?) AND statut='accepte'", u.id, u.id);
    out.demandes = n("SELECT COUNT(*) n FROM connexions WHERE vers_id=? AND statut='attente'", u.id);
  } else {
    out.consultations = n("SELECT COUNT(*) n FROM conversations WHERE patient_id=?", u.id);
  }
  res.json(out);
});

// ---------- fiches : aperçu pour tous, détail pour Premium ----------
app.get("/api/config", optUser, (req, res) => res.json({
  cats: CATS, whatsapp: WHATSAPP, price: PREMIUM_PRICE, currency: PREMIUM_CURRENCY, days: PREMIUM_DAYS, paiement: flexpay.configured() }));
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);
app.get("/api/fiches", optUser, (req, res) => {
  const full = !!req.user && isPremium(req.user);
  let sql = "SELECT id,nom,page,cat,risque,causes,symptomes,consequences,remedes,alerte FROM fiches WHERE valide=1";
  const args = [];
  const cat = parseInt(req.query.cat, 10);
  if (Number.isInteger(cat) && cat >= 0) { sql += " AND cat=?"; args.push(cat); }
  const q = String(req.query.q || "").trim();
  if (q) {
    // sans abonnement, on cherche seulement dans le nom, les causes et les symptômes
    const cols = full ? ["nom", "causes", "symptomes", "consequences", "remedes"] : ["nom", "causes", "symptomes"];
    sql += " AND (" + cols.map((c) => c + " LIKE ?").join(" OR ") + ")";
    for (const c of cols) args.push(`%${q}%`);
  }
  const rows = db.prepare(sql + " ORDER BY nom").all(...args);
  const imgs = new Map();
  for (const i of db.prepare("SELECT id,fiche_id,terme,auteur,licence,licence_url,source_url FROM fiche_images WHERE statut='ok' ORDER BY id").all()) {
    if (!imgs.has(i.fiche_id)) imgs.set(i.fiche_id, []);
    imgs.get(i.fiche_id).push({ id: i.id, terme: i.terme, auteur: i.auteur, licence: i.licence, licence_url: i.licence_url, source: i.source_url });
  }
  const withImg = (r) => ({ ...r, images: imgs.get(r.id) || [] });
  // le signe d'alerte reste toujours visible : c'est une information de sécurité
  res.json(full ? rows.map((r) => withImg({ ...r, locked: false })) :
    rows.map((r) => withImg({ ...r, causes: cut(r.causes, 80), symptomes: cut(r.symptomes, 80), consequences: cut(r.consequences, 45), remedes: cut(r.remedes, 45), locked: true })));
});
// image d'un remède : publique une fois validée par l'administrateur
app.get("/api/remede-img/:id", (req, res) => {
  const i = db.prepare("SELECT fichier,statut FROM fiche_images WHERE id=?").get(parseInt(req.params.id, 10));
  const adm = readToken("adm", cookies(req).pd_session || "") === ADMIN_USER;
  if (!i || (i.statut !== "ok" && !adm)) return res.sendStatus(404);
  res.set("Cache-Control", i.statut === "ok" ? "public, max-age=86400" : "private, no-store").type("image/jpeg")
    .sendFile(path.join(REMEDE_DIR, path.basename(i.fichier)));
});

// ---------- paiement Premium (FlexPaie) ----------
function activatePremium(order) {
  // idempotent : une commande payée n'ajoute qu'une seule fois 30 jours
  const r = db.prepare("UPDATE orders SET status='paid', paid_ms=? WHERE ref=? AND status<>'paid'").run(Date.now(), order.ref);
  if (!r.changes) return;
  const u = db.prepare("SELECT premium_until,nom FROM users WHERE id=?").get(order.user_id);
  if (!u) return;
  const start = Math.max(Date.now(), u.premium_until || 0);
  db.prepare("UPDATE users SET premium_until=? WHERE id=?").run(start + PREMIUM_DAYS * 86400e3, order.user_id);
  log(`Abonnement Premium payé : ${u.nom} (${order.amount} ${order.currency})`);
}
async function refreshOrder(order) {
  if (order.status === "pending" && order.order_number) {
    const s = await flexpay.checkOrder(order.order_number);
    if (s === "paid") activatePremium(order);
    else if (s === "failed") db.prepare("UPDATE orders SET status='failed' WHERE ref=?").run(order.ref);
    else if (Date.now() - order.created_ms > 30 * 60e3) db.prepare("UPDATE orders SET status='failed' WHERE ref=?").run(order.ref);
  }
  return db.prepare("SELECT * FROM orders WHERE ref=?").get(order.ref);
}
app.post("/api/premium/pay", needUser, rateLimit(6, 60e3), async (req, res) => {
  const u = req.user;
  if (u.role === "medecin") return res.status(400).json({ detail: "Les médecins n'ont pas d'abonnement à payer." });
  if (!flexpay.configured()) return res.status(503).json({ detail: "Le paiement n'est pas encore activé sur ce serveur." });
  const method = (req.body || {}).method === "card" ? "card" : "mobile";
  const phone = normalizePhone((req.body || {}).phone || u.telephone);
  if (method === "mobile" && !phone) return res.status(400).json({ detail: "Numéro invalide. Exemple : 0812345678" });
  const ref = "PD" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString("hex").toUpperCase();
  db.prepare("INSERT INTO orders(ref,user_id,method,phone,amount,currency,status,created_ms) VALUES(?,?,?,?,?,?,'pending',?)")
    .run(ref, u.id, method, phone, PREMIUM_PRICE, PREMIUM_CURRENCY, Date.now());
  try {
    if (method === "mobile") {
      const r = await flexpay.payMobile({ phone, reference: ref, amount: PREMIUM_PRICE, currency: PREMIUM_CURRENCY, callbackUrl: baseUrl(req) + "/api/flexpay/callback" });
      if (String(r.code) !== "0") throw new Error(r.message || "Paiement refusé");
      db.prepare("UPDATE orders SET order_number=? WHERE ref=?").run(r.orderNumber || null, ref);
      return res.json({ ref, method });
    }
    const r = await flexpay.payCard({ reference: ref, amount: PREMIUM_PRICE, currency: PREMIUM_CURRENCY, description: "Petit Docteur Premium 30 jours", baseUrl: baseUrl(req) });
    if (String(r.code) !== "0" || !r.url) throw new Error(r.message || "Paiement par carte indisponible");
    db.prepare("UPDATE orders SET order_number=? WHERE ref=?").run(r.orderNumber || null, ref);
    res.json({ ref, method, url: r.url });
  } catch (e) {
    db.prepare("UPDATE orders SET status='failed' WHERE ref=?").run(ref);
    res.status(502).json({ detail: String(e.message || e) });
  }
});
app.get("/api/premium/order/:ref", needUser, rateLimit(90, 60e3), async (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE ref=? AND user_id=?").get(req.params.ref, req.user.id);
  if (!o) return res.status(404).json({ detail: "Commande introuvable" });
  const f = await refreshOrder(o);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  res.json({ ref: f.status === undefined ? o.ref : f.ref, status: f.status, premium: isPremium(u), premium_until: u.premium_until });
});
// FlexPaie appelle cette adresse ; on ne fait jamais confiance au contenu, on vérifie auprès de FlexPaie
app.all("/api/flexpay/callback", async (req, res) => {
  const b = Object.assign({}, req.query, req.body);
  const o = (b.reference && db.prepare("SELECT * FROM orders WHERE ref=?").get(String(b.reference))) ||
    (b.orderNumber && db.prepare("SELECT * FROM orders WHERE order_number=?").get(String(b.orderNumber)));
  if (o) await refreshOrder(o);
  res.json({ ok: true });
});

// ---------- notifications push (même application fermée) ----------
let vapid = null;
if (webpush) {
  const vf = path.join(DATA_DIR, "vapid.json");
  try { vapid = JSON.parse(fs.readFileSync(vf, "utf8")); }
  catch (e) { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vf, JSON.stringify(vapid), { mode: 0o600 }); }
  webpush.setVapidDetails(BASE_URL || "https://sante.mireb.online", vapid.publicKey, vapid.privateKey);
}
const PUSH_T = {
  fr: { msg: "Nouveau message de {n}", call: "Appel vidéo de {n}", req: "{n} souhaite se connecter avec vous", acc: "{n} a accepté votre demande", ok: "Votre compte médecin est validé" },
  en: { msg: "New message from {n}", call: "Video call from {n}", req: "{n} wants to connect with you", acc: "{n} accepted your request", ok: "Your doctor account is approved" },
  sw: { msg: "Ujumbe mpya kutoka kwa {n}", call: "Simu ya video kutoka kwa {n}", req: "{n} anataka kuunganishwa nawe", acc: "{n} amekubali ombi lako", ok: "Akaunti yako ya daktari imethibitishwa" },
  ln: { msg: "Nsango ya sika uta {n}", call: "Libiangi ya vidéo uta {n}", req: "{n} azali kolinga kosangana na yo", acc: "{n} andimi ebongiseli na yo", ok: "Kompte na yo ya monganga endimami" },
  kg: { msg: "Nsangu ya mpa ya {n}", call: "Kubikisa ya vidéo ya {n}", req: "{n} kezola kuyika ngeye", acc: "{n} kondimi ndombolo na nge", ok: "Kompte ya nge ya ngangu ya nganga kondimama" },
  lua: { msg: "Mukanda mupiya wa {n}", call: "Dibikila dia vidéo dia {n}", req: "{n} udi musue kukuenzeja", acc: "{n} wakuambula dîyi diebe", ok: "Kompte yebe ya munganga mimane" },
};
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)\//i;
function notify(uid, key, n, url, urgent) {
  if (!webpush || !uid) return;
  let subs = [];
  try { subs = db.prepare("SELECT * FROM push_subs WHERE user_id=?").all(uid); } catch (e) { return; }
  for (const s of subs) {
    const L = PUSH_T[s.lang] || PUSH_T.fr;
    const payload = JSON.stringify({ title: "Petit Docteur", body: (L[key] || PUSH_T.fr[key]).replace("{n}", n || ""), url, tag: key + ":" + url, urgent: !!urgent });
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: urgent ? 45 : 86400, urgency: urgent ? "high" : "normal" })
      .catch((err) => { if (err && (err.statusCode === 404 || err.statusCode === 410)) db.prepare("DELETE FROM push_subs WHERE id=?").run(s.id); });
  }
}
app.get("/api/push/key", (req, res) => res.json({ key: vapid ? vapid.publicKey : "" }));
app.post("/api/push/subscribe", needUser, rateLimit(20, 60e3), (req, res) => {
  if (!webpush) return res.status(503).json({ detail: "Les notifications ne sont pas disponibles sur ce serveur." });
  const b = req.body || {}, k = b.keys || {};
  const endpoint = String(b.endpoint || "");
  if (endpoint.length > 600 || !PUSH_HOST.test(endpoint) || !k.p256dh || !k.auth || String(k.p256dh).length > 200 || String(k.auth).length > 100)
    return res.status(400).json({ detail: "Abonnement invalide." });
  const lang = ["fr", "en", "ln", "sw", "kg", "lua"].includes(b.lang) ? b.lang : "fr";
  db.prepare("INSERT INTO push_subs(user_id,endpoint,p256dh,auth,lang,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,lang=excluded.lang")
    .run(req.user.id, endpoint, String(k.p256dh), String(k.auth), lang, now());
  // au plus 5 appareils par compte : on garde les plus récents
  db.prepare("DELETE FROM push_subs WHERE user_id=? AND id NOT IN (SELECT id FROM push_subs WHERE user_id=? ORDER BY id DESC LIMIT 5)").run(req.user.id, req.user.id);
  res.json({ ok: true });
});
app.post("/api/push/unsubscribe", needUser, (req, res) => {
  db.prepare("DELETE FROM push_subs WHERE endpoint=? AND user_id=?").run(String((req.body || {}).endpoint || ""), req.user.id);
  res.json({ ok: true });
});

// ---------- messagerie ----------
const convOf = (id, uid) => {
  const c = db.prepare("SELECT * FROM conversations WHERE id=? AND (patient_id=? OR doctor_id=?)").get(id, uid, uid);
  return c || null;
};
const other = (c, uid) => db.prepare("SELECT id,nom,role,specialite,(photo<>'') has_photo FROM users WHERE id=?").get(c.patient_id === uid ? c.doctor_id : c.patient_id);

app.post("/api/conversations", needUser, needPremium, (req, res) => {
  const u = req.user;
  if (u.role !== "patient") return res.status(400).json({ detail: "Ce sont les patients qui démarrent une consultation." });
  const doc = db.prepare("SELECT id FROM users WHERE id=? AND role='medecin' AND statut='approuve'").get(parseInt((req.body || {}).doctor_id, 10));
  if (!doc) return res.status(404).json({ detail: "Médecin introuvable." });
  let c = db.prepare("SELECT id FROM conversations WHERE patient_id=? AND doctor_id=?").get(u.id, doc.id);
  if (!c) {
    const r = db.prepare("INSERT INTO conversations(patient_id,doctor_id,created_at) VALUES(?,?,?)").run(u.id, doc.id, now());
    c = { id: Number(r.lastInsertRowid) };
  }
  res.json({ id: c.id });
});
app.get("/api/conversations", needUser, (req, res) => {
  const u = req.user;
  const rows = db.prepare("SELECT * FROM conversations WHERE patient_id=? OR doctor_id=?").all(u.id, u.id);
  const out = rows.map((c) => {
    const last = db.prepare("SELECT texte,ts,from_id FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1").get(c.id);
    const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE conv_id=? AND from_id<>? AND lu=0").get(c.id, u.id).n;
    return { id: c.id, avec: other(c, u.id), dernier: last ? { texte: cut(last.texte, 80), ts: last.ts } : null, non_lus: unread };
  });
  out.sort((a, b) => ((b.dernier && b.dernier.ts) || "").localeCompare((a.dernier && a.dernier.ts) || ""));
  res.json(out);
});
app.get("/api/conversations/:id/messages", needUser, (req, res) => {
  const c = convOf(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  const after = parseInt(req.query.after, 10) || 0;
  const rows = db.prepare("SELECT id,from_id,texte,ts FROM messages WHERE conv_id=? AND id>? ORDER BY id LIMIT 200").all(c.id, after);
  db.prepare("UPDATE messages SET lu=1 WHERE conv_id=? AND from_id<>? AND lu=0").run(c.id, req.user.id);
  res.json({ avec: other(c, req.user.id), messages: rows });
});
app.post("/api/conversations/:id/messages", needUser, needPremium, rateLimit(40, 60e3), (req, res) => {
  const c = convOf(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  if (docPairBlocked(c)) return res.status(403).json({ detail: "Vous n'êtes plus connectés avec ce confrère." });
  const texte = clip((req.body || {}).texte, 2000);
  if (!texte) return res.status(422).json({ detail: "Message vide." });
  const r = db.prepare("INSERT INTO messages(conv_id,from_id,texte,ts) VALUES(?,?,?,?)").run(c.id, req.user.id, texte, now());
  notify(c.patient_id === req.user.id ? c.doctor_id : c.patient_id, "msg", req.user.nom, "/#/chat/" + c.id);
  res.json({ id: Number(r.lastInsertRowid) });
});

// ---------- appel vidéo (WebRTC, signalisation par requêtes courtes) ----------
const RING_MS = 45e3;
function liveCall(convId) {
  const c = db.prepare("SELECT * FROM calls WHERE conv_id=? AND state IN ('ringing','active') ORDER BY id DESC LIMIT 1").get(convId);
  if (!c) return null;
  const stale = c.state === "ringing" ? Date.now() - c.created_ms > RING_MS : Date.now() - c.updated_ms > 5 * 60e3;
  if (stale) { db.prepare("UPDATE calls SET state='ended' WHERE id=?").run(c.id); return null; }
  return c;
}
const callOut = (c) => ({ id: c.id, conv_id: c.conv_id, state: c.state, started_by: c.started_by, room: c.room });
function callFor(id, uid) {
  const c = db.prepare("SELECT * FROM calls WHERE id=?").get(id);
  return c && convOf(c.conv_id, uid) ? c : null;
}
app.get("/api/rtc-config", needUser, (req, res) => {
  const ice = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URLS) ice.push({ urls: process.env.TURN_URLS.split(","), username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" });
  res.json({ iceServers: ice });
});
app.post("/api/conversations/:id/call", needUser, needPremium, rateLimit(12, 60e3), (req, res) => {
  const c = convOf(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  if (docPairBlocked(c)) return res.status(403).json({ detail: "Vous n'êtes plus connectés avec ce confrère." });
  const live = liveCall(c.id);
  if (live) return res.json(callOut(live));
  const r = db.prepare("INSERT INTO calls(conv_id,started_by,state,room,created_ms,updated_ms) VALUES(?,?,'ringing',?,?,?)")
    .run(c.id, req.user.id, "PetitDocteur" + crypto.randomBytes(8).toString("hex"), Date.now(), Date.now());
  notify(c.patient_id === req.user.id ? c.doctor_id : c.patient_id, "call", req.user.nom, "/#/chat/" + c.id, true);
  res.json(callOut(db.prepare("SELECT * FROM calls WHERE id=?").get(Number(r.lastInsertRowid))));
});
app.get("/api/calls/:id", needUser, (req, res) => {
  const c = callFor(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  const live = c.state === "ended" ? null : liveCall(c.conv_id);
  res.json(live && live.id === c.id ? callOut(live) : { ...callOut(c), state: "ended" });
});
app.post("/api/calls/:id/accept", needUser, needPremium, (req, res) => {
  const c = callFor(req.params.id, req.user.id);
  if (!c || c.started_by === req.user.id) return res.sendStatus(404);
  const live = liveCall(c.conv_id);
  if (!live || live.id !== c.id) return res.status(410).json({ detail: "L'appel est terminé." });
  db.prepare("UPDATE calls SET state='active', updated_ms=? WHERE id=?").run(Date.now(), c.id);
  res.json({ ok: true });
});
app.post("/api/calls/:id/end", needUser, (req, res) => {
  const c = callFor(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  db.prepare("UPDATE calls SET state='ended' WHERE id=?").run(c.id);
  res.json({ ok: true });
});
app.post("/api/calls/:id/signal", needUser, rateLimit(400, 60e3), (req, res) => {
  const c = callFor(req.params.id, req.user.id);
  if (!c || c.state === "ended") return res.sendStatus(404);
  const kind = (req.body || {}).kind;
  if (!["offer", "answer", "ice"].includes(kind)) return res.status(400).json({ detail: "Signal invalide." });
  const payload = JSON.stringify((req.body || {}).payload || {});
  if (payload.length > 20000) return res.status(413).json({ detail: "Signal trop gros." });
  db.prepare("INSERT INTO signals(call_id,from_id,kind,payload,created_ms) VALUES(?,?,?,?,?)").run(c.id, req.user.id, kind, payload, Date.now());
  db.prepare("UPDATE calls SET updated_ms=? WHERE id=?").run(Date.now(), c.id);
  res.json({ ok: true });
});
app.get("/api/calls/:id/signals", needUser, (req, res) => {
  const c = callFor(req.params.id, req.user.id);
  if (!c) return res.sendStatus(404);
  const after = parseInt(req.query.after, 10) || 0;
  const rows = db.prepare("SELECT id,kind,payload FROM signals WHERE call_id=? AND from_id<>? AND id>? ORDER BY id LIMIT 200").all(c.id, req.user.id, after);
  db.prepare("UPDATE calls SET updated_ms=? WHERE id=? AND state='active'").run(Date.now(), c.id);
  res.json(rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) })));
});
// sondage léger : messages non lus et appels entrants
app.get("/api/inbox", needUser, (req, res) => {
  const u = req.user;
  const convs = db.prepare("SELECT id FROM conversations WHERE patient_id=? OR doctor_id=?").all(u.id, u.id);
  let non_lus = 0; const appels = [];
  for (const c of convs) {
    non_lus += db.prepare("SELECT COUNT(*) n FROM messages WHERE conv_id=? AND from_id<>? AND lu=0").get(c.id, u.id).n;
    const live = liveCall(c.id);
    if (live && live.state === "ringing" && live.started_by !== u.id) {
      const cv = db.prepare("SELECT * FROM conversations WHERE id=?").get(c.id);
      appels.push({ id: live.id, conv_id: c.id, de: other(cv, u.id).nom });
    }
  }
  const demandes = u.role === "medecin" ? db.prepare("SELECT COUNT(*) n FROM connexions WHERE vers_id=? AND statut='attente'").get(u.id).n : 0;
  res.json({ non_lus, appels, demandes, premium: isPremium(u) });
});

// ---------- API admin ----------
function cleanFiche(b) {
  const s = (v, max) => String(v == null ? "" : v).slice(0, max);
  const nom = s(b.nom, 200).trim();
  if (!nom) return null;
  const cat = Number.isInteger(b.cat) && b.cat >= 0 && b.cat < CATS.length ? b.cat : 5;
  return { nom, source: s(b.source, 100), page: s(b.page, 30), cat, risque: ["s", "p", "u"].includes(b.risque) ? b.risque : "p",
    causes: s(b.causes, 1500), symptomes: s(b.symptomes, 1500), consequences: s(b.consequences, 1500), remedes: s(b.remedes, 2500), alerte: s(b.alerte, 800), image: path.basename(s(b.image, 80)) };
}
app.get("/api/admin/fiches", needAdmin, (req, res) => res.json(db.prepare("SELECT * FROM fiches ORDER BY id").all()));
app.post("/api/admin/fiches", needAdmin, (req, res) => {
  const f = cleanFiche(req.body || {});
  if (!f) return res.status(422).json({ detail: "Le nom est obligatoire." });
  const r = db.prepare("INSERT INTO fiches(nom,source,page,cat,risque,causes,symptomes,consequences,remedes,alerte,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(f.nom, f.source, f.page, f.cat, f.risque, f.causes, f.symptomes, f.consequences, f.remedes, f.alerte, f.image, now(), now());
  log(`Fiche ajoutée : ${f.nom}`);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put("/api/admin/fiches/:id", needAdmin, (req, res) => {
  const f = cleanFiche(req.body || {});
  if (!f) return res.status(422).json({ detail: "Le nom est obligatoire." });
  // une fiche modifiée redevient « à valider »
  const r = db.prepare("UPDATE fiches SET nom=?,source=?,page=?,cat=?,risque=?,causes=?,symptomes=?,consequences=?,remedes=?,alerte=?,image=?,valide=0,valide_par='',updated_at=? WHERE id=?")
    .run(f.nom, f.source, f.page, f.cat, f.risque, f.causes, f.symptomes, f.consequences, f.remedes, f.alerte, f.image, now(), req.params.id);
  if (!r.changes) return res.status(404).json({ detail: "Fiche introuvable" });
  log(`Fiche modifiée (à revalider) : ${f.nom}`);
  res.json({ ok: true });
});
app.post("/api/admin/fiches/:id/valider", needAdmin, (req, res) => {
  const { valide, medecin = "" } = req.body || {};
  const med = String(medecin).trim().slice(0, 120);
  if (valide && !med) return res.status(400).json({ detail: "Indiquez le nom du médecin qui a relu la fiche." });
  const row = db.prepare("SELECT nom FROM fiches WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ detail: "Fiche introuvable" });
  db.prepare("UPDATE fiches SET valide=?,valide_par=?,updated_at=? WHERE id=?").run(valide ? 1 : 0, valide ? med : "", now(), req.params.id);
  log((valide ? `Fiche validée par ${med} : ` : "Validation retirée : ") + row.nom);
  res.json({ ok: true });
});
// ---- images des remèdes : recherche (Wikimedia Commons), validation, envoi manuel ----
const dropImage = (i) => { fs.rmSync(path.join(REMEDE_DIR, path.basename(i.fichier)), { force: true }); db.prepare("DELETE FROM fiche_images WHERE id=?").run(i.id); };
async function saveImage(ficheId, meta, buf, statut) {
  const r = db.prepare("INSERT INTO fiche_images(fiche_id,terme,titre,source_url,auteur,licence,licence_url,fichier,statut,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(ficheId, meta.terme || "", meta.titre || "", meta.source_url || "", meta.auteur || "", meta.licence || "", meta.licence_url || "", "tmp", statut, now());
  const id = Number(r.lastInsertRowid), name = `${id}.jpg`;
  try {
    const out = sharp ? await sharp(buf).rotate().resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer() : buf;
    fs.writeFileSync(path.join(REMEDE_DIR, name), out);
    db.prepare("UPDATE fiche_images SET fichier=? WHERE id=?").run(name, id);
    return id;
  } catch (e) { db.prepare("DELETE FROM fiche_images WHERE id=?").run(id); throw e; }
}
app.get("/api/admin/fiches/:id/images", needAdmin, (req, res) =>
  res.json(db.prepare("SELECT id,terme,titre,source_url,auteur,licence,licence_url,statut FROM fiche_images WHERE fiche_id=? ORDER BY id").all(req.params.id)));
app.post("/api/admin/fiches/:id/images/chercher", needAdmin, rateLimit(12, 60e3), async (req, res) => {
  const f = db.prepare("SELECT id,nom,remedes FROM fiches WHERE id=?").get(req.params.id);
  if (!f) return res.status(404).json({ detail: "Fiche introuvable" });
  try {
    let termes = Array.isArray((req.body || {}).termes) ? req.body.termes.map((t) => clip(t, 80)).filter(Boolean).slice(0, 4) : [];
    let par = "vous";
    if (!termes.length) {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ detail: "Écrivez un ou deux termes à chercher (ex : aloe vera), ou configurez ANTHROPIC_API_KEY pour que Claude les propose." });
      termes = await remedes.suggestTerms(f, process.env.ANTHROPIC_API_KEY, MODEL); par = "claude";
      if (!termes.length) return res.json({ ajoutees: 0, termes, par, detail: "Claude n'a trouvé aucun ingrédient concret à illustrer dans cette fiche." });
    }
    const deja = new Set(db.prepare("SELECT source_url FROM fiche_images WHERE fiche_id=?").all(f.id).map((r) => r.source_url));
    let n = 0;
    for (const terme of termes) {
      let found = [];
      try { found = await remedes.searchCommons(terme, 3); } catch (e) { continue; }
      for (const c of found) {
        if (deja.has(c.page)) continue;
        try { await saveImage(f.id, { terme, titre: c.titre, source_url: c.page, auteur: c.auteur, licence: c.licence, licence_url: c.licence_url }, await remedes.download(c.thumb), "propose"); deja.add(c.page); n++; } catch (e) { /* image suivante */ }
      }
    }
    log(`Images proposées pour « ${f.nom} » : ${n}`);
    res.json({ ajoutees: n, termes, par });
  } catch (e) { res.status(502).json({ detail: "Recherche d'images impossible pour le moment : " + String(e.message || e).slice(0, 120) }); }
});
app.post("/api/admin/fiches/:id/images/envoyer", needAdmin, (req, res) => {
  const f = db.prepare("SELECT id,nom FROM fiches WHERE id=?").get(req.params.id);
  if (!f) return res.status(404).json({ detail: "Fiche introuvable" });
  avatarUpload.single("file")(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ detail: "Image trop lourde (8 Mo maximum) ou illisible." });
    try {
      await saveImage(f.id, { terme: clip(req.body.terme, 80), titre: "Photo de l'éditeur", auteur: "Petit Docteur", licence: "Photo de l'éditeur" }, req.file.buffer, "ok");
      log(`Image ajoutée à « ${f.nom} »`); res.json({ ok: true });
    } catch (e) { res.status(400).json({ detail: "Ce fichier n'est pas une image lisible." }); }
  });
});
app.post("/api/admin/images/:iid/statut", needAdmin, (req, res) => {
  const st = (req.body || {}).statut;
  if (!["ok", "refuse", "propose"].includes(st)) return res.status(400).json({ detail: "Statut invalide." });
  db.prepare("UPDATE fiche_images SET statut=? WHERE id=?").run(st, parseInt(req.params.iid, 10));
  res.json({ ok: true });
});
app.delete("/api/admin/images/:iid", needAdmin, (req, res) => {
  const i = db.prepare("SELECT id,fichier FROM fiche_images WHERE id=?").get(parseInt(req.params.iid, 10));
  if (i) dropImage(i);
  res.json({ ok: true });
});
app.delete("/api/admin/fiches/:id", needAdmin, (req, res) => {
  const row = db.prepare("SELECT nom FROM fiches WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ detail: "Fiche introuvable" });
  for (const i of db.prepare("SELECT id,fichier FROM fiche_images WHERE fiche_id=?").all(req.params.id)) dropImage(i);
  db.prepare("DELETE FROM fiches WHERE id=?").run(req.params.id);
  log(`Fiche supprimée : ${row.nom}`);
  res.json({ ok: true });
});
app.get("/api/admin/image/:name", needAdmin, (req, res) => {
  const p = path.join(IMG_DIR, path.basename(req.params.name));
  if (!fs.existsSync(p)) return res.sendStatus(404);
  res.type("image/jpeg").sendFile(p);
});

// médecins : l'administrateur vérifie le numéro d'ordre avant d'approuver
app.get("/api/admin/medecins", needAdmin, (req, res) => res.json(db.prepare(
  "SELECT id,nom,telephone,specialite,numero_ordre,ville,statut,created_at,(photo<>'') has_photo FROM users WHERE role='medecin' ORDER BY (statut='attente') DESC, id DESC").all()));
app.post("/api/admin/medecins/:id/statut", needAdmin, (req, res) => {
  const statut = (req.body || {}).statut;
  if (!["approuve", "refuse", "attente"].includes(statut)) return res.status(400).json({ detail: "Statut invalide." });
  const u = db.prepare("SELECT nom FROM users WHERE id=? AND role='medecin'").get(req.params.id);
  if (!u) return res.status(404).json({ detail: "Médecin introuvable" });
  db.prepare("UPDATE users SET statut=? WHERE id=?").run(statut, req.params.id);
  if (statut === "approuve") notify(parseInt(req.params.id, 10), "ok", "", "/#/");
  log(`Médecin ${statut === "approuve" ? "approuvé" : statut === "refuse" ? "refusé" : "remis en attente"} : ${u.nom}`);
  res.json({ ok: true });
});
app.get("/api/admin/abonnes", needAdmin, (req, res) => {
  const paid = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM orders WHERE status='paid'").get();
  res.json({
    actifs: db.prepare("SELECT COUNT(*) n FROM users WHERE role='patient' AND premium_until>?").get(Date.now()).n,
    comptes: db.prepare("SELECT COUNT(*) n FROM users WHERE role='patient'").get().n,
    paiements: paid.n, total: paid.total, devise: PREMIUM_CURRENCY,
    derniers: db.prepare("SELECT o.ref,o.method,o.status,o.amount,o.created_ms,COALESCE(u.nom,'(compte supprimé)') nom FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_ms DESC LIMIT 50").all() });
});
app.get("/api/admin/photo/:id", needAdmin, (req, res) => {
  const t = db.prepare("SELECT photo FROM users WHERE id=? AND role='medecin'").get(req.params.id);
  if (!t || !t.photo) return res.sendStatus(404);
  res.type("image/jpeg").sendFile(path.join(AVATAR_DIR, path.basename(t.photo)));
});

const PROMPT = `Tu aides un administrateur à numériser un livre de médecine populaire.
La photo montre une page. Repère chaque maladie ou mal traité sur la page et réponds UNIQUEMENT par un tableau JSON.
Chaque élément a ces clés :
- "nom" : titre de la rubrique (court)
- "page" : numéro de page imprimé, ou "" si illisible
- "cat" : entier parmi ${JSON.stringify(Object.assign({}, CATS))}
- "risque" : "s" (faible), "p" (prudence) ou "u" (maladie sérieuse : voir un médecin)
- "causes" : causes du mal selon le livre (une ou deux phrases), ou "" si le livre n'en parle pas
- "symptomes" : symptômes décrits, en une ou deux phrases
- "consequences" : conséquences ou complications si le mal n'est pas soigné, ou "" si absent
- "remedes" : remèdes proposés par le livre, résumés
- "alerte" : quand il faut consulter ou signe de danger ; si le livre propose un remède douteux ou dangereux, dis-le ici
Règles : reformule avec tes propres mots (40 mots maximum par champ, aucune phrase recopiée) ;
n'invente rien qui ne soit pas sur la page ; ignore les passages sans rapport avec la santé ;
si la page ne contient aucune rubrique de santé, réponds []. Pas de texte hors du JSON.`;

function parseFiches(text) {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < a) throw new Error("pas de JSON");
  const out = [];
  for (const it of JSON.parse(text.slice(a, b + 1))) {
    if (!it || typeof it !== "object" || !String(it.nom || "").trim()) continue;
    const f = cleanFiche(it);
    if (f) { delete f.image; delete f.source; out.push(f); }
  }
  return out;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });
app.post("/api/admin/lire", needAdmin, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ detail: err.code === "LIMIT_FILE_SIZE" ? "Image trop lourde (15 Mo maximum)." : "Envoi impossible." });
    if (!req.file) return res.status(400).json({ detail: "Aucun fichier reçu." });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ detail: "La clé ANTHROPIC_API_KEY n'est pas encore configurée sur le serveur." });
    let jpeg;
    try {
      if (!sharp) throw new Error("no sharp");
      jpeg = await sharp(req.file.buffer).rotate().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch (e) {
      if (/^image\/(jpeg|png)$/.test(req.file.mimetype) && !sharp) jpeg = req.file.buffer;
      else return res.status(400).json({ detail: "Ce fichier n'est pas une image lisible." });
    }
    const name = crypto.randomUUID().replace(/-/g, "") + ".jpg";
    fs.writeFileSync(path.join(IMG_DIR, name), jpeg);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: PROMPT }] }] }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ detail: "Lecture impossible : " + ((data.error && data.error.message) || "erreur du service IA") });
      let fiches;
      try { fiches = parseFiches((data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")); }
      catch (e) { return res.status(502).json({ detail: "La réponse de l'IA n'était pas lisible. Réessayez avec une photo plus nette." }); }
      log(`Page lue par l'IA : ${fiches.length} fiche(s) proposée(s)`);
      res.json({ image: name, fiches });
    } catch (e) {
      res.status(502).json({ detail: "Service IA injoignable. Réessayez." });
    }
  });
});

app.get("/api/admin/taches", needAdmin, (req, res) => {
  const jour = today();
  if (!db.prepare("SELECT 1 x FROM taches WHERE jour=?").get(jour))
    for (const t of DEFAULT_TASKS) db.prepare("INSERT INTO taches(jour,texte) VALUES(?,?)").run(jour, t);
  res.json(db.prepare("SELECT * FROM taches WHERE jour=? ORDER BY id").all(jour));
});
app.post("/api/admin/taches", needAdmin, (req, res) => {
  const t = String((req.body || {}).texte || "").trim().slice(0, 200);
  if (!t) return res.status(422).json({ detail: "Texte obligatoire." });
  db.prepare("INSERT INTO taches(jour,texte) VALUES(?,?)").run(today(), t);
  log(`Tâche ajoutée : ${t}`);
  res.json({ ok: true });
});
app.post("/api/admin/taches/:id/fait", needAdmin, (req, res) => {
  const row = db.prepare("SELECT texte FROM taches WHERE id=?").get(req.params.id);
  if (!row) return res.sendStatus(404);
  const fait = !!(req.body || {}).fait;
  db.prepare("UPDATE taches SET fait=? WHERE id=?").run(fait ? 1 : 0, req.params.id);
  log((fait ? "Tâche faite : " : "Tâche rouverte : ") + row.texte);
  res.json({ ok: true });
});
app.get("/api/admin/journal", needAdmin, (req, res) =>
  res.json(db.prepare("SELECT ts,texte FROM journal WHERE ts>=? ORDER BY id DESC LIMIT 200").all(today())));

// ---------- pages ----------
// Les fichiers peuvent être dans static/ ou à la racine du dépôt : on les cherche aux deux endroits.
// Liste blanche : jamais le dossier entier, pour ne pas exposer server.js ni seed.json.
const findFile = (name) => [path.join(__dirname, "static", name), path.join(__dirname, name)].find((p) => fs.existsSync(p));
const sendPage = (name, cache) => (req, res) => {
  const f = findFile(name);
  if (!f) return res.sendStatus(404);
  res.set("Cache-Control", cache); res.sendFile(f);
};
app.get("/", sendPage("index.html", "no-cache"));
app.get("/medecin", sendPage("index.html", "no-cache"));
app.get("/admin", sendPage("admin.html", "no-store"));
app.get("/confidentialite", sendPage("confidentialite.html", "no-cache"));
app.get("/conditions", sendPage("conditions.html", "no-cache"));
app.get("/suppression", (req, res) => res.redirect(302, "/confidentialite#suppression"));
// lien Android (application Play Store) : empreintes de la clé de signature, à ajouter dans ANDROID_SHA256 (séparées par des virgules)
app.get("/.well-known/assetlinks.json", (req, res) => {
  const fp = String(process.env.ANDROID_SHA256 || "").split(",").map((x) => x.trim()).filter(Boolean);
  res.json(fp.length ? [{ relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: process.env.ANDROID_PACKAGE || "online.mireb.sante", sha256_cert_fingerprints: fp } }] : []);
});
// PWA : manifeste, service worker (à la racine pour couvrir tout le site) et icônes
app.get("/manifest.webmanifest", (req, res) => { res.type("application/manifest+json"); sendPage("manifest.webmanifest", "no-cache")(req, res); });
app.get("/sw.js", (req, res) => { res.type("application/javascript").set("Service-Worker-Allowed", "/"); sendPage("sw.js", "no-cache")(req, res); });
for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "shot-1.png", "shot-2.png", "shot-3.png"])
  app.get("/" + icon, (req, res) => { res.type("image/png"); sendPage(icon, "public, max-age=86400")(req, res); });
app.get("/static/:f", (req, res) => {
  if (!["app.js", "style.css", "i18n.js"].includes(req.params.f)) return res.sendStatus(404);
  sendPage(req.params.f, "public, max-age=300")(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Petit Docteur sur le port " + PORT));
