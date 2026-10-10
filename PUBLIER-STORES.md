# Publier Petit Docteur sur Play Store et App Store

L'application est une PWA (installable, hors ligne partiel, notifications). Elle peut être emballée sans réécriture.

## Avant de commencer
- Comptes : Google Play Console (frais unique d'environ 25 USD), Apple Developer (environ 99 USD par an, et un Mac est nécessaire pour compiler iOS).
- Adresse publique des règles : https://sante.mireb.online/confidentialite · Conditions : /conditions · Suppression de compte : https://sante.mireb.online/suppression
- Captures d'écran déjà prêtes : /shot-1.png, /shot-2.png, /shot-3.png (540x960). Icônes : /icon-512.png, /icon-maskable-512.png.

## Android (Play Store) : application TWA
1. Aller sur https://www.pwabuilder.com, entrer https://sante.mireb.online, choisir « Android », package par exemple `online.mireb.sante`.
2. PWABuilder fournit le fichier .aab et l'empreinte SHA-256 de la clé de signature.
3. Sur Hostinger, ajouter les variables `ANDROID_PACKAGE=online.mireb.sante` et `ANDROID_SHA256=<empreinte>`, puis relancer. Vérifier https://sante.mireb.online/.well-known/assetlinks.json (sans cela, une barre d'adresse reste visible dans l'app).
4. Play Console : créer l'application, envoyer le .aab, remplir la fiche (description, captures, catégorie Santé), la déclaration « Sécurité des données » (téléphone, nom, messages de santé, paiements), l'URL des règles de confidentialité et l'URL de suppression de compte.
5. Test fermé obligatoire pour les nouveaux comptes personnels (12 testeurs pendant 14 jours), puis production.

## iPhone (App Store)
1. Sur Mac : PWABuilder « iOS » ou Capacitor, avec Xcode.
2. App Store Connect : fiche, captures, règles de confidentialité, étiquettes de confidentialité, compte de démonstration pour les relecteurs (créer un patient Premium et un médecin approuvé).
3. Les notifications d'une app iOS native demandent APNs ; la version PWA installée depuis Safari reçoit déjà les notifications.

## Risques à connaître
- **Paiement** : Apple (règle 3.1.1) et Google (Play Billing) exigent leur propre paiement pour les contenus numériques vendus dans l'app. L'abonnement Premium par mobile money peut être refusé. Solutions : vendre l'abonnement seulement sur le site, ou accepter la commission des stores.
- **Apple 4.2** : une simple page web emballée peut être refusée ; mettre en avant les notifications, la vidéo et les messages.
- **Santé** : les stores demandent que l'app ne remplace pas un médecin. L'avertissement existe déjà dans les fiches ; garder la mention.
- **Vidéo sur réseaux mobiles** : ajouter un serveur TURN (`TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
