# Halo sur Telegram : prototype de migration

Ce dossier prépare une **application Halo autonome** qui utilise TDLib sur iOS et Android. Il ne crée pas de Mini App. Le bot Halo tourne sur Telegram Serverless et sa base SQLite intégrée. La version actuellement affichée par Vite utilise encore le backend local du dépôt : elle n'est pas déjà passée sur Telegram.

## Flux prévu

1. Les deux personnes s'identifient avec leur compte Telegram dans Halo. Une invitation `i` puis une acceptation `a` établissent le contact. Le propriétaire autorise explicitement la lecture de sa position avec `v`.
2. Quand le partage est activé, Halo crée une clé aléatoire de 256 bits et une session. Il transmet la clé à chaque contact choisi dans un **Secret Chat TDLib**. La clé reste dans le stockage sécurisé des téléphones. Après livraison des clés, Halo envoie au bot un point chiffré `s`, puis des remplacements `u` à la fréquence choisie. Une seule ligne de position existe par propriétaire. Le bot ne reçoit ni latitude ni longitude en clair.
3. Le contact qui ouvre la carte envoie une requête inline `g` au bot ; le bot vérifie son identité Telegram et les autorisations SQL, puis lui renvoie le dernier blob chiffré. Halo le déchiffre localement. Aucune requête inline n'est sélectionnée ou envoyée dans un chat.
4. L'arrêt `x` efface le blob. Une révocation `r` retire l'accès SQL. Avant tout nouveau partage avec un autre ensemble de contacts, Halo doit créer **une nouvelle clé** et la distribuer seulement aux personnes encore autorisées.
5. Les messages ordinaires et les signaux bipper, après l'appui maintenu, passent directement de personne à personne dans des Secret Chats TDLib. Le bot n'y participe pas. La fonction d'envoi vérifie le type et l'état du Secret Chat avant d'envoyer.

## Ce qui est codé ici

- `tgcloud/` : schéma SQLite, contrôle des contacts et autorisations, remplacement atomique de la dernière position, handler de requêtes inline.
- `client/protocol.mjs` : création de session et de clé, chiffrement AES-GCM de la position, commandes compactes et lecture des réponses TDLib.
- `client/secretChats.mjs` : contrôle d'un Secret Chat, envoi des textes bipper et distribution de clé.
- `test/` : tests locaux du protocole, du chiffrement, de l'arrêt et du contrôle d'accès.

## Ce qu'il reste à brancher pour l'utiliser sur téléphone

- Créer ou activer le bot Halo dans **@BotFather**, activer **Serverless** et le mode **inline**. Installer la CLI dans ce dossier avec `npm install`, lier le bot localement avec `npx tgcloud login`, puis déployer avec `npx tgcloud push` et créer les tables avec `npx tgcloud migrate`. Ne jamais commiter `.tgcloud/`, un jeton de bot, un `api_hash` ou une clé privée.
- Obtenir les identifiants d'application Telegram (`api_id` / `api_hash`) via `my.telegram.org`, intégrer TDLib dans les projets natifs Android et iOS, puis relier le client TDLib à l'interface Capacitor existante. Un Secret Chat est lié à un appareil : le destinataire doit l'accepter sur celui où Halo est installé.
- Faire dépendre le suivi en arrière-plan du service natif de localisation et d'un transport TDLib persistant. Le JavaScript de la WebView ne peut pas garantir l'envoi quand iOS suspend l'application. Le mode 15 s reste un **objectif à mesurer** sur appareils réels ; Telegram peut limiter les requêtes inline et iOS/Android peuvent retarder les relevés.
- Ajouter la gestion locale persistante des clés, l'arrivée des invitations et des clés dans les Secret Chats, la vérification visuelle des clés de chat et la rotation de clé lors d'une révocation. Puis migrer les écrans et retirer l'ancien backend et l'ancien historique de sept jours.

La réponse chiffrée est placée dans la `description` d'un résultat inline. La documentation Telegram permet de lire des résultats inline sans envoyer de message, mais ne garantit pas cet usage comme canal de synchronisation à 15 secondes. Il faut le valider avec deux comptes et deux appareils avant d'en faire l'architecture finale.

## Vérification locale

Depuis ce dossier : `node --test test/protocol.test.mjs`.
