# APK2WEB v1.0.0

Première version livrable de la plateforme **APK2WEB** : reconstruction web d'applications
Android décompilées, entièrement locale, avec export statique prêt à héberger.

## Fonctionnalités

- **Tableau de bord** : projets persistés dans IndexedDB, import, suppression, état de fidélité.
- **Import** : APK, ZIP de décompilation apktool/jadx, ou dossier complet (glisser-déposer,
  sélecteur de fichiers, sélecteur de dossier). Racine commune retirée automatiquement.
- **Analyse** : manifeste, `strings.xml`, `colors.xml`, `dimens.xml`, `arrays.xml`, `public.xml`,
  layouts (avec `<include>`), drawables et shapes XML, assets, bibliothèques natives, Smali.
- **Reconstruction** : widgets Android → HTML/CSS (Text, Button, Image, Input, Checkbox, Switch,
  SeekBar, ProgressBar, Listes, Spinner, Tabs, FAB, WebView, Surface…), marges, paddings,
  gravité, poids, arrière-plans, arrondis et contrastes de texte.
- **Interactions** : handlers `onClick` Smali traduits en navigation, retour, bascule, message et
  son. Le code Android n'est jamais exécuté.
- **Aperçu web** : iframe isolée et sandboxée, six tailles d'écran, plein écran, rechargement,
  **test d'exécution** du site généré (rendu des écrans, erreurs JS, routeur).
- **Éditeur** : modification des fichiers générés et des sources Android (XML/Smali), persistée
  et réappliquée à chaque génération.
- **Console de diagnostic** et **rapport de capacités** : reconstruit / partiel / simulé / non
  converti, moteurs détectés, avertissements.
- **Export ZIP** : `index.html`, `style.css`, `script.js`, `src/modules/`, `assets/{images,sounds,fonts}`,
  `README.md`, `.htaccess` — scripts classiques, aucune dépendance, compatible o2switch.
- **Projet de démonstration** inclus : `examples/DemoProject.zip`.

## Vérifications effectuées

- `tsc --noEmit` : aucune erreur.
- `vitest run` : **20 tests réussis** (analyse, conversion, export ZIP, IndexedDB, ingestion,
  cas APK binaire + moteur Unity, honnêteté du niveau de fidélité).
- `vite build` : build de production réussi.
- Test de bout en bout dans un navigateur : import du projet démo, génération, navigation entre
  deux écrans, test d'exécution (`2 écrans rendus, 3 actions, 0 erreur JavaScript`), export ZIP
  téléchargé et structure contrôlée.

## Téléchargement

- Application prête à héberger : `downloads/APK2WEB-v1.0.0.zip`
- Projet de démonstration : `examples/DemoProject.zip`
- SHA-256 de l'archive : `cbdae53e30df494de1e035322413a4be14aefc1b404a4057f4db806517e45e05`

## Installation

Décompressez l'archive et copiez son contenu dans `public_html` (o2switch/cPanel) ou servez-le
avec un serveur statique. `index.html` est le point d'entrée. Pour développer :

```bash
npm install
npm run dev
```

## Limites assumées

APK2WEB ne reconstitue pas l'application d'origine : le bytecode Dalvik n'est pas exécuté, les
layouts à contraintes sont approximés en flexbox, les fragments/Compose/WebView dynamiques ne sont
pas convertis, et les moteurs natifs (Unity, Unreal, Flutter, React Native…) sont détectés puis
signalés comme non reconstructibles. Chaque export documente ses éléments manquants.
