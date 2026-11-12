# APK2WEB

**Reconstruire une expérience web HTML/CSS/JS à partir des ressources d'une application Android décompilée.**

APK2WEB est un atelier local (aucun serveur, aucune donnée envoyée) qui importe un APK, un ZIP
décompilé (apktool/jadx) ou un dossier, analyse les layouts XML, les ressources et les handlers
Smali, puis génère un site statique autonome, exportable en ZIP et directement hébergeable.

> **Ce que APK2WEB ne fait pas.** Un APK ou du code Smali ne peut pas s'exécuter dans un navigateur.
> APK2WEB ne prétend jamais reconstituer l'application d'origine : il reconstruit l'interface à partir
> des ressources et **simule** les interactions qu'il parvient à identifier. La logique métier, les
> moteurs de jeu natifs, le réseau et le stockage Android ne sont pas reproduits, et l'outil l'indique
> explicitement dans son rapport et dans le README de chaque export.

Utilisez APK2WEB uniquement sur des applications dont vous détenez les droits (vos propres
applications, projets open source, autorisation écrite de l'éditeur).

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Démarrage rapide](#démarrage-rapide)
- [Import](#import)
- [Analyse et conversion](#analyse-et-conversion)
- [Aperçu web](#aperçu-web)
- [Éditeur de ressources](#éditeur-de-ressources)
- [Export ZIP](#export-zip)
- [Hébergement (o2switch, Apache, Nginx)](#hébergement-o2switch-apache-nginx)
- [Architecture du code](#architecture-du-code)
- [Tests](#tests)
- [Limites connues](#limites-connues)
- [Projet de démonstration](#projet-de-démonstration)

---

## Fonctionnalités

| Domaine | Détail |
| --- | --- |
| Tableau de bord | Liste des projets stockés en local, état de génération, fidélité, suppression |
| Nouveau projet | Projet vide nommé, puis import à la demande |
| Import | APK, ZIP (décompilation apktool), dossier complet par glisser-déposer ou sélecteur |
| Analyse | Manifeste, `strings.xml`, `colors.xml`, `dimens.xml`, `arrays.xml`, `public.xml`, layouts, drawables (dont shapes XML), assets, bibliothèques natives, Smali |
| Reconstruction | Conversion des widgets Android en HTML/CSS (Text/Button/Image/Input/List/Progress/SeekBar/WebView/Surface…), fonds, marges, paddings, gravité, poids, includes |
| Interactions | Extraction des `setOnClickListener` et de leurs handlers Smali : navigation `startActivity`, retour `finish`, bascule, message, son |
| Navigation | Routeur web par hash entre les écrans détectés, sélecteur d'écran |
| Web Preview | iframe isolée (`sandbox`), tailles d'écran simulées, plein écran, rechargement, test d'exécution |
| Éditeur | Modification des fichiers générés (HTML/CSS/JS) et des sources Android (XML/Smali), persistée dans IndexedDB |
| Console | Journal de diagnostic (import, analyse, génération, export, console de l'iframe) |
| Rapport | Capacités reconstruites / partielles / simulées / non converties, moteurs détectés, avertissements, liste des écrans |
| Export | ZIP complet `APK2WEB/…`, structure prête pour un hébergement classique |
| Stockage | IndexedDB (projets, fichiers, modifications, résumés de génération) — rien ne quitte le navigateur |

---

## Démarrage rapide

Prérequis : **Node.js 20 ou plus** et npm.

```bash
npm install
npm run dev          # http://localhost:3000
```

Production :

```bash
npm run build        # typecheck + build dans dist/
npm run preview      # prévisualisation du build
```

Le build utilise des chemins relatifs : `dist/` peut être déposé à la racine d'un domaine ou dans un
sous-dossier.

---

## Import

Trois modes, tous traités localement :

1. **Fichier APK** — les images, sons, polices et bibliothèques natives sont extraits. Un APK brut
   contient un manifeste binaire (AXML) et des ressources binaires : APK2WEB le signale et ne peut
   pas reconstruire l'interface. Pour cela, décompilez d'abord avec apktool :
   `apktool d mon-app.apk -o mon-app`.
2. **ZIP décompilé** — arborescence apktool : `AndroidManifest.xml`, `res/`, `assets/`, `lib/`,
   `smali/`, `smali_classes2/`, `smali_classes3/`, `original/`. Un dossier racine unique est retiré
   automatiquement.
3. **Dossier** — glisser-déposer du dossier (Chrome, Edge, Safari récent) ou bouton
   « Parcourir un dossier ».

Limites : 96 Mo par fichier, 768 Mo au total, 40 000 fichiers. Les entrées système
(`__MACOSX`, `.DS_Store`, signatures) sont ignorées. Un contenu déjà importé est remplacé, pas dupliqué.

---

## Analyse et conversion

### Ressources

- `res/values/strings.xml` (et variantes de langue détectées), `colors.xml`, `dimens.xml`,
  `arrays.xml`, `public.xml` (table des identifiants).
- `res/layout*/…xml` : chaque layout est parsé, les `<include>` sont développés.
- `res/drawable*/…` et `mipmap*/…` : images sélectionnées par densité ; les shapes XML
  (`solid`, `gradient`, `corners`, `stroke`) deviennent des styles CSS.
- `assets/` : images, sons, polices et configurations.
- `lib/**/*.so` : bibliothèques natives listées comme non convertibles.

### Activités et navigation

Les activités sont lues dans le manifeste, leur layout est retrouvé via `setContentView` et la table
`public.xml` (repli heuristique sur le nom du layout). Les handlers de clic sont cherchés dans les
classes internes `Activité$1`, et leur corps Smali est classé :

| Smali détecté | Action web générée |
| --- | --- |
| `startActivity` + classe cible | navigation vers l'écran cible |
| `finish()` | retour |
| `setVisibility` / `setChecked` | bascule simulée |
| `Toast` / `setText` | message simulé |
| `MediaPlayer` / `SoundPool` | lecture d'un son de l'export |
| autre | bouton inerte listé dans le rapport |

L'analyse est **heuristique** : elle ne remplace pas un décompilateur. Les associations vue → action
non résolues sont comptées et affichées.

### Fidélité

Chaque génération porte un niveau explicite :

- `assets` — ressources seulement, aucun layout exploitable ;
- `interface` — interface reconstruite, interactions absentes ou partielles ;
- `interactive` — interface + interactions identifiées, **simulées** (le code Android n'est pas exécuté).

Le statut « Testé dans l'aperçu » n'est attribué qu'après un test d'exécution réussi dans l'iframe
(rendu des écrans, absence d'erreur JavaScript, routeur présent). Il ne signifie pas que
l'application Android fonctionne à l'identique.

---

## Aperçu web

- iframe `sandbox="allow-scripts allow-forms allow-modals allow-popups"` : aucun accès au parent,
  aucun accès à IndexedDB du projet.
- Tailles simulées : responsive, 360×640, 390×844, 412×915, 768×1024, 1280×800.
- Plein écran, rechargement, test d'exécution.
- Les images/sons/polices utilisés sont intégrés en data URL dans l'aperçu (budget ~26 Mo) pour
  fonctionner sans accès au disque du projet.

---

## Éditeur de ressources

- **Site généré** : `index.html`, `style.css`, `script.js`, `src/modules/*.js`, `README.md`,
  `.htaccess`. Les modifications sont conservées et réappliquées à chaque génération.
- **Sources Android** : fichiers texte, XML et Smali. La version modifiée est utilisée par l'analyse
  (par exemple modifier `strings.xml` change les textes reconstruits).
- « Réinitialiser » restaure la version d'origine.

Tout est stocké dans IndexedDB (store `edits`), jamais envoyé sur un réseau.

---

## Export ZIP

```
APK2WEB/
├── index.html
├── style.css
├── script.js
├── assets/
│   ├── images/
│   ├── sounds/
│   └── fonts/
├── src/
│   └── modules/
│       ├── data.js
│       ├── router.js
│       └── interactions.js
├── README.md
└── .htaccess
```

- Scripts classiques (pas de modules ES) : `index.html` fonctionne aussi en double-clic, sans serveur.
- Aucune dépendance locale, aucun fichier de build, aucune source map.
- Le README inclus liste les écrans, les capacités reconstruites, les éléments manquants, le
  diagnostic et la procédure d'installation.
- Budget d'export : 110 Mo d'images, 40 Mo de sons, 20 Mo de polices. Au-delà, les fichiers les plus
  volumineux sont omis et signalés.

---

## Hébergement (o2switch, Apache, Nginx)

### o2switch / cPanel

1. Décompressez l'archive ZIP.
2. Copiez **le contenu** de `APK2WEB/` dans `public_html/` (ou un sous-dossier).
3. Vérifiez que `index.html` est bien à la racine du dossier choisi.
4. Le fichier `.htaccess` fourni active l'index par défaut, la compression, le cache et quelques
   en-têtes de sécurité.

### Serveur local

```bash
cd APK2WEB
python3 -m http.server 8080
# http://localhost:8080
```

---

## Architecture du code

```
src/
├── main.ts                 # amorçage de l'application
├── style.css               # interface APK2WEB
├── lib/
│   ├── types.ts            # modèle partagé
│   ├── files.ts            # types de fichiers, MIME, tailles, couleurs, dimensions
│   ├── android.ts          # parsing XML Android, ressources, shapes, layouts
│   ├── ingest.ts           # APK/ZIP/dossier, limites, dédoublonnage, racine
│   ├── zip.ts              # lecture/écriture ZIP (fflate)
│   ├── analyze.ts          # manifeste, layouts, Smali, capacités, diagnostic
│   ├── convert.ts          # génération HTML/CSS/JS, assets, aperçu, README export
│   ├── exporter.ts         # ZIP final APK2WEB
│   └── db.ts               # IndexedDB (projets, fichiers, éditions, builds)
└── ui/
    ├── app.ts              # routeur hash
    ├── dashboard.ts        # tableau de bord, import, projets
    ├── workspace.ts        # explorateur, aperçu, éditeur, console, rapport, export
    ├── dom.ts              # helpers DOM, icônes, dialogues, toasts
    └── busy.ts             # overlay de progression
```

Technologies : **HTML5, CSS3, TypeScript, Vite, IndexedDB, fflate**. Aucun framework UI, aucun
backend.

---

## Tests

```bash
npm test        # vitest : analyse, conversion, export ZIP, IndexedDB, import
npm run build   # typecheck strict + build Vite
```

La suite couvre un projet décompilé synthétique (deux activités, layouts, `public.xml`, shapes,
handlers Smali, assets) et un APK binaire avec moteur Unity. Elle vérifie notamment que la
conversion n'annonce jamais une reconstruction complète et que le ZIP contient la structure requise.

---

## Limites connues

- Le Smali n'est **pas exécuté** ; les interactions sont des simulations identifiées.
- Les layouts à contraintes (`ConstraintLayout`, `RelativeLayout`, `FrameLayout`) sont approximés en
  flexbox : pas de mesure réelle, pas de rendu pixel-perfect.
- Les styles/thèmes (`styles.xml`, attributs `?attr/…`) ne sont que partiellement résolus.
- Les fragments, Jetpack Compose, vues personnalisées et contenus chargés dynamiquement ne sont pas
  reconstruits.
- Unity, Unreal, Cocos2d-x, libGDX, Godot, GameMaker, Flutter et React Native sont détectés et
  explicitement marqués non reconstructibles.
- Une seule variante de layout et une seule langue (valeurs par défaut) sont utilisées.
- L'aperçu et l'export peuvent omettre les ressources qui dépassent les budgets indiqués.

---

## Projet de démonstration

```bash
node tools/make-demo.mjs
```

Génère `examples/DemoProject/` (projet décompilé factice complet) et `examples/DemoProject.zip`.
Importez le ZIP dans APK2WEB pour vérifier l'analyse, la navigation entre deux écrans, l'aperçu et
l'export. Ce projet ne contient aucun code d'application réelle.

---

## Licence et usage

Projet fourni à des fins de reconstruction et d'apprentissage. Les ressources importées restent la
propriété de leurs ayants droit. L'utilisateur est responsable du respect des licences et des droits
applicables à toute application traitée.
