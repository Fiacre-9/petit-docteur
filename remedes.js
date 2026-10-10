"use strict";
/* Images de remèdes : recherche d'images sous licence libre sur Wikimedia Commons, et aide de Claude
   pour trouver les ingrédients à illustrer. Rien n'est publié sans validation de l'administrateur. */
const COMMONS = process.env.COMMONS_API || "https://commons.wikimedia.org/w/api.php";
const UA = "PetitDocteur/1.0 (https://sante.mireb.online; fiches de sante illustrees)";
const OK_MIME = /^image\/(jpeg|png|webp)$/;
const FREE = /^(cc[- ]by(?![- ]?n[cd])|cc[- ]by-sa|cc0|public domain|pd)/i;

async function getJson(url, opt) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...(opt || {}), signal: ctl.signal, headers: { "User-Agent": UA, ...((opt && opt.headers) || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const strip = (h) => String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 160);

async function searchCommons(term, max) {
  const u = new URL(COMMONS);
  const p = { action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "12", gsrsearch: term + " filetype:bitmap",
    prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "640" };
  for (const k of Object.keys(p)) u.searchParams.set(k, p[k]);
  const d = await getJson(u.toString());
  const pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const pg of pages) {
    const ii = pg.imageinfo && pg.imageinfo[0];
    if (!ii || !OK_MIME.test(ii.mime || "") || !ii.thumburl || (ii.width || 0) < 300) continue;
    const m = ii.extmetadata || {};
    const licence = strip(m.LicenseShortName && m.LicenseShortName.value);
    if (!FREE.test(licence)) continue;
    out.push({ titre: strip(pg.title).replace(/^File:/, ""), thumb: ii.thumburl, page: ii.descriptionurl || "", auteur: strip(m.Artist && m.Artist.value) || "Auteur inconnu",
      licence, licence_url: strip(m.LicenseUrl && m.LicenseUrl.value) });
    if (out.length >= (max || 3)) break;
  }
  return out;
}

async function download(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 8 * 1024 * 1024) throw new Error("image trop lourde");
    return b;
  } finally { clearTimeout(t); }
}

// Claude propose jusqu'à 4 ingrédients à illustrer, avec un terme de recherche en anglais ou en latin
async function suggestTerms(fiche, apiKey, model) {
  const prompt = "Voici les remèdes d'une fiche de santé d'un livre de médecine populaire.\nMal : " + fiche.nom + "\nRemèdes : " + fiche.remedes +
    "\n\nListe au plus 4 ingrédients concrets à illustrer par une photo (plantes, fruits, aliments, produits). Pour chacun, donne un terme de recherche précis pour Wikimedia Commons : nom anglais courant ou nom latin. " +
    "Réponds UNIQUEMENT par un tableau JSON de chaînes, par exemple [\"Aloe vera\",\"Ginger root\"]. Tableau vide s'il n'y a rien de concret.";
  const d = await getJson("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: "user", content: prompt }] }) });
  const text = (d.content || []).map((c) => c.text || "").join("");
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < a) return [];
  return JSON.parse(text.slice(a, b + 1)).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 4);
}
module.exports = { searchCommons, download, suggestTerms };
