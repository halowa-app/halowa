# Halo — application hybride iOS / Android

Halo est un prototype fonctionnel de cercle de confiance : carte OpenStreetMap, signaux rapides, chat chiffré, partage de position configurable et pointage de sécurité. L’interface est en français et s’adapte au téléphone. Le bouton **« Je vais bien »** exige un appui continu de 2, 3 ou 5 secondes (3 secondes par défaut).

## Essayer l’application

Prévoir Node.js 24 ou plus récent (SQLite intégré à Node).

```powershell
npm install
npm run server
```

Dans un second terminal :

```powershell
npm run dev
```

Ouvrir `http://localhost:5173`, puis **Explorer la démo**. Cette démo utilise uniquement des personnes fictives. Pour tester entre deux comptes réels, créer deux comptes dans deux profils de navigateur distincts, envoyer une invitation par identifiant et l’accepter sur le second compte.

Le serveur conserve les comptes et les messages chiffrés dans `server/data.json`, et l’historique chiffré des positions dans `server/data.json.locations.sqlite`. Ces fichiers sont ignorés par Git. Arrêter le serveur avant de copier les deux fichiers pour sauvegarder les données de test.

## Installer sur Android et iOS

Les projets natifs sont inclus dans `android/` et `ios/`.

```powershell
npm run sync
npx cap open android
```

Pour iOS, exécuter `npm run sync` puis `npx cap open ios` **sur un Mac équipé de Xcode**. Android nécessite Android Studio et son SDK. Les paquets installables et la publication sur les boutiques ne peuvent pas être produits sur cette machine sans ces environnements et les comptes de signature correspondants.

Dans l’app installée, renseigner l’URL **HTTPS** publique de l’API dans les réglages avant de créer un compte. L’API Node écoute sur le port 8787 et doit être placée derrière un reverse proxy HTTPS. Définir `CORS_ORIGIN` avec l’origine web autorisée si une version web est déployée. Ne pas utiliser l’adresse `localhost` du téléphone pour joindre le serveur de développement.

Dans **Réglages → Mode de partage de position**, choisir : **En continu**, **À l’ouverture de l’app**, ou **À intervalle choisi**. Le mode programmé propose 15 s, 30 s, 1 min, 5 min, 10 min, 30 min, 45 min, 1 h, 2 h, 3 h, 6 h et 12 h. Les choix s’appliquent au prochain partage. Après avoir choisi les destinataires, le partage reste actif jusqu’à l’arrêt manuel et reprend à l’ouverture de l’app. Le mode « à l’ouverture » envoie une nouvelle position au lancement et au retour dans l’app, sans suivi en arrière-plan.

Sur iOS et Android, les modes continu et programmé demandent la localisation en arrière-plan. Android affiche une notification persistante et demande sa permission. La fréquence choisie est une cible : le système peut retarder ou interrompre les événements, notamment si l’app est fermée de force, si le téléphone reste immobile ou si la batterie est économisée. Ces modes doivent être validés sur de vrais appareils avant un usage réel.

Le téléphone partageant envoie toujours ses relevés chiffrés au serveur à la fréquence choisie, même si aucun contact ne regarde la carte. Le serveur conserve l’historique chiffré **7 jours** dans SQLite, puis le supprime automatiquement. La position actuelle est diffusée au contact choisi uniquement pendant que sa carte est ouverte au premier plan. Le contact peut toucher un avatar pour voir son parcours, jour par jour ; la carte ne demande alors que les positions de ce contact pour la période affichée. Arrêter le partage efface immédiatement l’historique partagé si le serveur est joignable. Si le téléphone est hors ligne, Halo enregistre la demande d’effacement et la réessaie ; entre-temps, l’accès au parcours cesse au plus tard lorsque la dernière position devient périmée.

Cette règle « seulement quand la carte est ouverte » décrit le comportement de l’app : un contact déjà approuvé qui possède ses identifiants et sa clé de déchiffrement pourrait interroger directement l’API pendant que le partage est actif. Le serveur ne peut pas prouver qu’une carte est réellement affichée sur son appareil.

## Fonctionnement de la confidentialité

- Une invitation doit être acceptée avant tout échange.
- Les messages, signaux et coordonnées sont chiffrés sur l’appareil avec TweetNaCl `box` avant envoi. Le serveur ne stocke que les enveloppes chiffrées, les identifiants d’expéditeur et destinataire, le type et l’heure.
- La clé privée est placée dans Keychain sur iOS ou Keystore sur Android par `capacitor-secure-storage`. La version navigateur stocke la clé localement **sans protection équivalente** ; elle est réservée à la démonstration et au développement.
- Les codes de clés affichés dans la conversation et les réglages permettent une vérification manuelle entre proches. Il n’existe pas encore de sauvegarde ou transfert de clé entre appareils.
- Une position actuelle expire selon le mode : 15 minutes en continu, 24 heures après une ouverture, ou à l’intervalle programmé augmenté de 5 minutes (avec un minimum de 10 minutes). L’historique chiffré est conservé 7 jours, mais n’est consultable par un contact que tant que sa dernière position est encore actuelle. L’arrêt demande l’effacement de toutes les positions au serveur ; sans connexion, il sera réessayé.
- Les envois de position restent chiffrés sur l’appareil. Le mode et l’intervalle sont transmis au serveur en clair pour définir l’expiration. Les clés et le contenu des coordonnées ne lui sont pas transmis en clair.
- La veille de sécurité déclenche une alerte **dans l’application** après l’intervalle choisi, augmenté de 2 heures de grâce. Le contact doit ouvrir Halo pour la voir. Il n’y a pas encore de notification push, SMS ou appel automatique.

## Limites avant un lancement public

Ce prototype doit être renforcé avant un usage comme dispositif de sécurité : migration du reste des données serveur vers une base transactionnelle et sauvegardes, vérification des comptes, limitation du nombre de tentatives de connexion, récupération sécurisée des clés, notifications APNs/FCM, tests sur appareils réels, audit du protocole de chiffrement, surveillance et disponibilité du serveur. Une absence de pointage ne constitue jamais une preuve de danger. Halo ne remplace pas les services d’urgence.

La carte emploie [OpenStreetMap](https://www.openstreetmap.org/copyright) via [OpenFreeMap](https://openfreemap.org/quick_start/) et [MapLibre](https://maplibre.org/), sans service Google. Son style local `public/map-style.json` utilise des couleurs relevées sur les captures de Plans fournies pour ce projet : eau cyan, parcs vert clair, zones urbaines beige et routes grises à cœur blanc. Le dégradé bleu en SVG fourni apparaît derrière l’avatar de l’utilisateur à sa position exacte. Le mode démonstration affiche une position fictive pour permettre de voir ce repère sans autoriser la géolocalisation. Prévoir un hébergement de tuiles adapté au trafic avant un déploiement à grande échelle.

Les libellés de la carte et l’interface superposée utilisent `public/fonts/SF-Pro-Rounded-Regular.otf`, le fichier fourni pour ce prototype privé. MapLibre charge cette police localement, sans service distant de glyphes. Le fichier est inclus dans les projets Android et iOS synchronisés. Avant une diffusion à d’autres personnes, vérifier les droits attachés à cette police.

## Vérifications

```powershell
npm run build
npm run test:server
```

Le test du serveur vérifie le refus d’envoyer avant approbation, l’envoi après approbation, le retrait des positions et le déclenchement d’une alerte de pointage manqué.

## Inspiration

Le principe du pointage simple reprend l’idée de l’application chinoise Sileme (« Are You Dead? »), qui permet à une personne vivant seule de confirmer quotidiennement qu’elle va bien et prévient un contact après des pointages manqués. Voir [AP](https://apnews.com/article/163f051b9108b93b0356c4e9aa01c1ef) et [Euronews](https://www.euronews.com/2026/01/14/what-is-the-are-you-dead-app-and-why-is-it-so-popular-in-china-and-beyond).
