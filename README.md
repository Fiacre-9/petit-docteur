# Petit Docteur

- `/` : fiches de santé. Sans compte : aperçu limité (les signes d'alerte restent toujours visibles). Liste des médecins visible, contact verrouillé.
- Abonnés **Premium** (7 000 FC / 30 jours, payés par FlexPaie) : fiches complètes, profil avec photo, messages et appel vidéo avec les médecins.
- `/medecin` : espace médecin (nom complet, spécialité, photo, présentation, disponibilité). Gratuit. Le numéro d'ordre est vérifié par l'administrateur avant que le médecin soit visible.
- `/admin` : fiches (lecture de pages par Claude, validation par un médecin), médecins à approuver, abonnés et paiements, tâches, journal.

Node.js 22.13+ (SQLite intégré), Express. Les messages ne sont affichés qu'au patient et à son interlocuteur ; aucun écran d'administration ne les montre.

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

## Réseau des médecins (v3)
- Annuaire des confrères (médecins validés uniquement) avec filtres spécialité, ville, disponibilité.
- Demandes de connexion : envoyer, accepter, refuser, annuler, retirer. Message et appel vidéo entre confrères seulement après acceptation.
- Profil médecin enrichi : cabinet ou hôpital, langues, années d'expérience.
- Nouveau design : barre latérale, panneaux, tuiles d'actions, cartes de profil.

## Version 4
- **Notifications** même application fermée (Web Push, clés VAPID créées automatiquement dans `DATA_DIR/vapid.json`). Message, appel vidéo, demande de confrère, validation du compte médecin. Le texte du message n'est jamais envoyé dans la notification. Sur iPhone : seulement après « Ajouter à l'écran d'accueil ».
- **Images des remèdes** : dans `/admin`, bouton Images de chaque fiche. Recherche sur Wikimedia Commons (licences CC BY, CC BY-SA, CC0, domaine public uniquement ; NC et ND exclues), ou ajout depuis la galerie. Rien n'est public avant validation ; l'auteur et la licence s'affichent sous la photo. `ANTHROPIC_API_KEY` permet à Claude de proposer les ingrédients à chercher.
- **Fiches** : causes, symptômes, conséquences, remèdes.
- **Langues** : français, English, Lingála, Kiswahili, Kikongo, Tshiluba (les textes en kikongo et tshiluba sont partiels et à faire relire).
- **Paiement** affiché : M-Pesa, Orange Money, Airtel Money, Afrimoney, carte Visa (via FlexPaie).
- **WhatsApp** : `WHATSAPP_NUMBER` (chiffres seulement, avec l'indicatif du pays, ex. 243…).
- **Stores** : pages `/confidentialite`, `/conditions`, suppression de compte dans l'app (`/suppression`), `/.well-known/assetlinks.json` (variables `ANDROID_PACKAGE`, `ANDROID_SHA256`). Voir `PUBLIER-STORES.md`.
