# Documentation : L'Interface Web 3D du RoboMaster S1

Cette documentation présente l'**interface web 3D** du projet : ce qu'elle affiche, comment la lancer, comment elle lit les logs du robot, et ses limites actuelles.

---

## Sommaire
1. [Vue d'Ensemble](#1-vue-densemble)
2. [Lancement de l'Interface](#2-lancement-de-linterface)
3. [Page de Connexion & Mot de Passe](#3-page-de-connexion--mot-de-passe)
4. [La Scène du Vaisseau Spatial](#4-la-scène-du-vaisseau-spatial)
5. [L'Onglet Logs (Tableau de Bord Grafana)](#5-longlet-logs-tableau-de-bord-grafana)
6. [Import des Logs du Robot](#6-import-des-logs-du-robot)
7. [Limites : Liaison avec les Commandes du Robot](#7-limites--liaison-avec-les-commandes-du-robot)
8. [Arborescence de l'Interface Web](#8-arborescence-de-linterface-web)

---

## 1. Vue d'Ensemble

En complément du Cockpit Web Tactique, une **interface web 3D** affiche l'activité du robot sous la forme d'une scène spatiale immersive :
- **Le robot devient un vaisseau spatial** 🚀 en vol stationnaire au milieu des étoiles.
- **Chaque cible détectée par l'IA devient un astéroïde** ☄️ qui fonce vers le vaisseau.
- **Chaque tir automatique pulvérise l'astéroïde** 💥 avec rayons laser, boule de feu et débris.
- **Un onglet Logs** 📊 affiche le tableau de bord Grafana des logs.
- **L'accès est protégé par un identifiant et un mot de passe** 🔒.
- **L'animation est pilotée par le journal des actions du robot** (`robot_actions.log`) : l'interface rejoue fidèlement ce que le robot a vu et fait.

L'interface est une application **React + three.js** servie par **Vite**, située dans le dossier `cmd/hub/web`.

```
┌───────────────────────────────────────────┐
│        JOURNAL DES ACTIONS DU ROBOT       │
│             (robot_actions.log)           │
│                                           │
│  [VISION] Target 'BOTTLE' detected ...    │
│  [LOCK]   Target 'BOTTLE' locked ...      │
│  [FIRE]   Automatic infrared fire ...     │
└─────────────────────┬─────────────────────┘
                      │
          Lignes brutes du log (texte)
                      │
                      ▼
┌───────────────────────────────────────────┐
│        LECTEUR DE LOG (robotLog.ts)       │
│                                           │
│  - Découpe chaque ligne (date, catégorie) │
│  - Déduit l'état : cible en vue, lock,    │
│    mode auto, nombre de tirs auto         │
│  - Anti-clignotement : cible perdue       │
│    seulement après 2 s sans détection     │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│          SCÈNE 3D (React + three.js)      │
│         (http://localhost:5173/app/)      │
│                                           │
│  - Vaisseau spatial (le robot)            │
│  - Astéroïde (la cible détectée)          │
│  - Rafales laser & explosion (tir auto)   │
│  - Batterie, Mode Auto, Temps de mission  │
└───────────────────────────────────────────┘
```

---

## 2. Lancement de l'Interface

Dans un terminal, depuis la racine du projet :
```bash
cd cmd/hub/web
npm install              # uniquement la première fois
npm run dev -- --host
```

Puis ouvrez votre navigateur sur :
👉 **`http://localhost:5173/app/`**

- L'option `--host` rend l'interface accessible depuis **n'importe quel appareil du réseau** (téléphone, tablette...) via l'adresse `Network` affichée par Vite dans le terminal.
- La page se **recharge automatiquement** à chaque modification du code, sans relancer le serveur.
- Sans robot, l'interface fonctionne en **mode simulation** ou en **Mode Replay** (voir section 6).

---

## 3. Page de Connexion & Mot de Passe

Toute l'interface (onglets **Interface** et **Logs**) est protégée par une page de connexion :
👉 `http://localhost:5173/app/login`

1. **Identifiant & mot de passe** : définis dans le fichier **`cmd/hub/web/src/auth.ts`**, constantes `USERNAME` et `PASSWORD`. Pour les changer, il suffit de modifier ces deux valeurs.
2. **Redirection automatique** : toute page ouverte sans être connecté renvoie vers la connexion, puis ramène à la page demandée une fois connecté.
3. **Erreur de saisie** : le message `Identifiant ou mot de passe incorrect` s'affiche en rouge et le champ mot de passe est vidé.
4. **Session** : la connexion reste active tant que l'onglet est ouvert. Le bouton **`Déconnexion`** se trouve en haut à droite de la barre de navigation.

> ⚠️ **Limite de sécurité** : la vérification est effectuée dans le navigateur et le mot de passe est lisible dans le code JavaScript envoyé. Il s'agit d'une barrière simple contre les visiteurs, et non d'une sécurité forte.

---

## 4. La Scène du Vaisseau Spatial

- **Vaisseau** (`src/components/Spaceship.tsx`) : chasseur spatial en vol stationnaire, dont la **longueur des flammes des réacteurs suit le niveau de batterie**.
- **Panneau de gauche** : jauge de **Batterie** (verte, orange puis rouge) et indicateur **Mode Auto**.
- **Panneau de droite** : **Temps de mission** (`HH:MM:SS`).
- **Caméra** : rotation libre à la souris et zoom à la molette.

### Cycle de Vie de l'Astéroïde (`src/components/Asteroid.tsx`) :
| Phase | Ce qui se passe à l'écran |
| :--- | :--- |
| `Approche` | Une cible est détectée : l'astéroïde surgit du brouillard et avance lentement vers le vaisseau |
| `Rafales` | En mode auto, les deux canons en bout d'aile tirent **2,5 rafales laser rouges par seconde** sur l'astéroïde |
| `Tir final` | À chaque tir automatique, un laser continu frappe l'astéroïde de plein fouet |
| `Explosion` | 💥 Boule de feu (1,4 s), onde de choc (1,1 s), **260 étincelles** (1,8 s) et débris incandescents qui refroidissent |
| `Retrait` | La cible n'est plus détectée : l'astéroïde repart dans le brouillard |

### Bannière d'Alerte :
- `⚠️ WARNING - Obstacle détecté : tir automatique en cours` (orange) : une cible est en vue et le Mode Auto est activé.

Tous les réglages de l'animation sont des constantes en haut de `Asteroid.tsx` : `BURST_RATE`, `BURST_DUTY`, `FIREBALL_TIME`, `SHOCKWAVE_TIME`, `SPARK_TIME`, `SPARK_COUNT`.

---

## 5. L'Onglet Logs (Tableau de Bord Grafana)

L'onglet **Logs** (`http://localhost:5173/app/logs`) affiche dans la page un **tableau de bord Grafana public**.
- L'adresse du tableau de bord est la constante `LOGS_URL` de **`cmd/hub/web/src/pages/Logs.tsx`**.
- Pour afficher une autre page sans modifier le code : `http://localhost:5173/app/logs?src=<adresse>`.

---

## 6. Import des Logs du Robot

L'interface sait **lire directement les lignes du journal d'actions** (même format que `robot_actions.log`) et s'en sert pour piloter toute l'animation à la place de la simulation. La lecture est assurée par **`cmd/hub/web/src/robotLog.ts`**.

### Correspondance Log → Animation :
| Ligne du log | Effet dans l'interface 3D |
| :--- | :--- |
| `[VISION] Target '...' detected (Area: ... px)` | ☄️ L'astéroïde apparaît |
| `[VISION] Target lost from view` | L'astéroïde repart (après **2 s** sans nouvelle détection) |
| `[LOCK] Target '...' locked at crosshair center` | 🔒 Cible verrouillée |
| `[FIRE] Automatic infrared fire triggered on target '...'` | 💥 Tir final & explosion de l'astéroïde |
| `[AI] ... AutoFire: True` / `[CONFIG] Auto-fire on lock setting updated: false` | Mode Auto activé / coupé |
| `[CONNECTION]` / `[DISCONNECTION]` | Robot connecté / déconnecté |

- **Anti-clignotement** : la détection de l'IA saute souvent (cible perdue puis retrouvée en moins d'une seconde). L'astéroïde ne disparaît donc qu'après **2 secondes sans détection**.
- **Pas de double explosion** : chaque tir automatique est suivi d'une ligne `Infrared fire triggered`. Seule la ligne `Automatic infrared fire` déclenche l'explosion.

### Rejouer un Log Enregistré (Mode Replay) :
1. Ouvrez l'interface avec le paramètre `?replay` :
   👉 `http://localhost:5173/app/?replay`
   *(Ajoutez une vitesse pour accélérer : `?replay=5` rejoue 5 fois plus vite.)*
2. L'heure du log rejoué s'affiche en bas de l'écran (`Relecture du log du robot : 10:25:32`).
3. Les longues pauses du log sont raccourcies à **4 secondes** et la relecture **tourne en boucle**.
4. **Pour importer un nouveau log** : copiez votre fichier `robot_actions.log` dans :
   👉 `cmd/hub/web/src/replay/session.log`
5. Sans `?replay`, l'interface fonctionne en **mode simulation** : la touche <kbd>O</kbd> fait apparaître ou disparaître un astéroïde.

### Branchement en Direct des Logs :
Une API renverra les **lignes brutes du log**, dans le même format que le fichier. Il suffira de transmettre ces lignes à la fonction `parseLine` de `robotLog.ts` : **aucune autre modification de l'interface ne sera nécessaire**.

---

## 7. Limites : Liaison avec les Commandes du Robot

Nous n'avons **pas pu relier la page web à l'interface de connexion et de commande du robot** (prise en main, tir, etc.) à cause du **Raspberry Pi**. L'interface 3D ne permet donc **pas de piloter le robot ni de tirer** : elle sert uniquement à visualiser son activité.

En revanche, **les logs du robot seront bien reliés à la page** : on pourra ainsi **voir le robot tirer en mode auto** en direct, chaque tir automatique faisant exploser l'astéroïde dans la scène 3D (voir section 6).

---

## 8. Arborescence de l'Interface Web

```text
cmd/hub/web/
│
├── package.json              <-- Dépendances (React, three.js, Vite)
├── vite.config.ts            <-- Configuration du serveur Vite (base /app/)
│
└── src/
    ├── main.tsx              <-- Routes : /login, / (Interface), /logs
    ├── auth.ts               <-- Identifiant, mot de passe & session de connexion
    ├── robotLog.ts           <-- Lecteur du journal d'actions & état de la vision
    ├── useReplay.ts          <-- Mode Replay : relecture d'un log enregistré (?replay)
    ├── useRobotStats.ts      <-- Stats affichées : simulation ou log du robot
    ├── styles.css            <-- Styles de toute l'interface
    │
    ├── replay/
    │   └── session.log       <-- Log rejoué par le Mode Replay (à remplacer pour importer un log)
    │
    ├── pages/
    │   ├── Login.tsx         <-- Page de connexion
    │   ├── Interface.tsx     <-- Scène 3D, panneaux & bannière d'alerte
    │   └── Logs.tsx          <-- Onglet Logs (tableau de bord Grafana)
    │
    └── components/
        ├── Layout.tsx        <-- Barre de navigation & bouton Déconnexion
        ├── Spaceship.tsx     <-- Le vaisseau spatial
        └── Asteroid.tsx      <-- L'astéroïde, les rafales laser & l'explosion
```
