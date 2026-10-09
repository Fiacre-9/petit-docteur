# Petit Docteur

- `/` : fiches de santé. Sans compte : aperçu limité (les signes d'alerte restent toujours visibles). Liste des médecins visible, contact verrouillé.
- Abonnés **Premium** (7 000 FC / 30 jours, payés par FlexPaie) : fiches complètes, profil avec photo, messages et appel vidéo avec les médecins.
- `/medecin` : espace médecin (nom complet, spécialité, photo, présentation, disponibilité). Gratuit. Le numéro d'ordre est vérifié par l'administrateur avant que le médecin soit visible.
- `/admin` : fiches (lecture de pages par Claude, validation par un médecin), médecins à approuver, abonnés et paiements, tâches, journal.

Node.js 22.13+ (SQLite intégré), Express. Les messages ne sont lisibles que par le patient et son médecin, pas par l'administrateur.

## Variables d'environnement (jamais dans le dépôt)
- `SECRET_KEY` (32+), `ADMIN_PASSWORD` (10+), `ADMIN_USER`
- `BASE_URL` : https://sante.mireb.online (adresses de retour FlexPaie)
- `FLEXPAY_MERCHANT=MARCO_SERVICE`, `FLEXPAY_TOKEN` (Bearer fourni par FlexPaie)
- `PREMIUM_PRICE` (7000), `PREMIUM_CURRENCY` (CDF)
- `ANTHROPIC_API_KEY` : lecture des pages par IA ; `WHATSAPP_NUMBER` (facultatif)
- Appel vidéo : `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` (serveur TURN conseillé pour les réseaux mobiles)
- `DATA_DIR` : base et images (défaut `~/petit-docteur-data`)

## Local
```bash
npm install
SECRET_KEY=... ADMIN_PASSWORD=... COOKIE_SECURE=0 node server.js
```
