# SVRpwaB - Project Context (backend-variant)

Dit bestand is de werkcontext voor de AI-assistent (opencode) in deze repo. Lees dit vóór je wijzigingen doet. Zie ook `README.md` (mensgerichte docs) en de AGENTS.md van de hoofd-repo `SVRpwa/` (de originele app op de svr.nl-schraapachterkant).

## Project Overview

**SVRpwaB** is de **snellere variant** van de SVR-campings PWA. Zelfde functionaliteit als de hoofd-PWA, maar met een dedicated Cloudflare-Worker backend (`SVRpwa-backend`) i.p.v. de svr.nl-schraapachterkant. Zoeken, filteren en detailpagina's laden daardoor merkbaar sneller.

**Belangrijk onderscheid met `SVRpwa/`:**
- **Data komt live uit de API** (`GET /api/objects`, `GET /api/objects/{objectId}`, `GET /api/filter-data`) — er is **géén** `data/campings.json`.
- **Eigen versiereeks** (`1.6.x`), losgekoppeld van de hoofd-app (`0.2.x`).
- **Andere cache-prefix** (`svr-pwa-b` i.p.v. `svr-pwa-a`).

### Architectuur
- Statische PWA, geen build-stap, vanilla JS (jQuery voor een deel van de DOM)
- Leaflet 1.9.4 + Leaflet.markercluster
- Backend: `https://svr-backend.e60-manuels.workers.dev`
- Desktop split-screen: kaart links (60%), lijst/detail/filter rechts (40%); breakpoint 768px
- Mobiel: fullscreen overlays voor detail/filter/favorieten, toggle tussen kaart en lijst

---

## Building and Running

```bash
python -m http.server 8000      # of: npx serve . / php -S localhost:8000
```

Open daarna `http://localhost:8000`.

- **Productie:** https://e60manuels.github.io/SVRpwa-backend/ (auto-deploy via GitHub Pages bij push naar `main`)
- **Git remote:** enkel `origin` → `https://github.com/e60manuels/SVRpwa-backend.git` (géén staging-remote)
- **Deploy:** `git push origin main`

> Let op: poort 8000 is vaak al bezet door de hoofd-PWA. Gebruik dan een andere poort (bijv. 8001); localStorage/favorieten zijn per origin (poort) gescheiden.

---

## Versioning (bij elke wijziging synchroniseren)

De versie staat op **meerdere plekken** en moet overal gelijk omhoog:

| Bestand | Plek |
| --- | --- |
| `js/config.js` | `window.SVR_PWA_VERSION = '1.6.x'` |
| `js/app.js` | regel ~3: `window.SVR_PWA_VERSION = "1.6.x"` |
| `js/pwa_install.js` | `const APP_VERSION = "1.6.x"` |
| `sw.js` | `const CACHE_NAME = 'svr-pwa-b-v1.6.x'` |
| `index.html` | `?v=1.6.x` op `local_style.css`, `custom_styles.css`, `config.js`, `app.js`, `pwa_install.js` |
| `version.json` | `{ "version": "1.6.x" }` (versiepobe, zie v1.6.9) |

- Let op: `version.json` moet bewust **niet** in de SW-precache; hij wordt bij opstart met unieke querystring opgehaald om de CDN-cache te omzeilen.

- Kaart-tile-cache: `svr-pwa-b-tiles` (blijft ongewijzigd)
- Cache-strategie: app-shell network-first met cache-fallback; statische assets cache-first met `ignoreSearch`; API network-only
- Controleer na edits: `node --check js/app.js js/config.js js/pwa_install.js sw.js`

---

## Data-model (API)

Camping-objecten uit de backend hebben deze vorm (afwijkend van de hoofd-PWA!):

```js
{
  id: "...",
  geometry: { coordinates: [lng, lat] },   // let op: [lng, lat]
  properties: { name: "...", city: "...", type_camping: "..." },
  distM: 12345
}
```

Gebruik dus **`obj.properties.name`**, **`obj.properties.city`**, **`obj.geometry.coordinates[1]=lat` / `[0]=lng`**. Er is géén `obj.naam/stad/lat/lng`.

---

## Belangrijke functies en secties in `js/app.js`

- `// [SECTION: INITIALIZATION]` (~r49): opstart, `window.loadStaticCampsites` (~r160), `resetSearch` (~r651)
- `// [SECTION: CSV_SEARCH_LOGIC]` (~r208): gemeentedata (`assets/Woonplaatsen_in_Nederland.csv`), `getCoordinatesWeb` → `{ latitude, longitude }`
- `// [SECTION: NETWORK_PROXY]` (~r287): `fetchCampingObjects`, `fetchFilterData`, `fetchDetailData`
- Zoeken: `normalizeSearchText` (r10), `getCampingNameMatches` (r23), `campingSearchIndex` (opgebouwd in `loadStaticCampsites`), `getSuggestionsLocal` (plaatsen 📍 eerst, dan campingnamen ⛺)
- `window.performSearch` (~r2062): `_searchIntent` = `'place'`/`'camping'`; camping-suggestie → direct `renderCampingResults`; geocoding mislukt → fallback op campingnamen (offline-proof)
- `renderCampingResults` (r1236), `getPlaceSearchViewBounds` (r1221), `centroidOf` (r1187), single-match `map.fitBounds`
- `renderResults` (~r2666): lijstkaarten (naam klikbaar naar detail) + markers, gebatcht
- Detail: `window.showSVRDetailPage` (~r1536), hartje `id="heart_{id}"` → `window.toggleSVRFavorite`
- Panelen: `window.openRightPanel(type)` / `window.closeRightPanel()`, `onpopstate` — `type` ∈ `detail`/`filter`/`favorites`

### Favorieten
- Opslag: `localStorage['svr_favorites']` (JSON-array van object-id's)
- Functies: `toggleSVRFavorite`, `isSVRFavorite`, `getFavoriteIds`, `saveFavoriteIds`, `showFavorites`, `hideFavoritesOverlay`, `closeFavoritesOverlay`, `openFavoriteDetail`, `openFavoriteMap`, `clearFavorites`, `renderFavoritesOverlayContent`
- Overlay: `#svr-favorites-overlay` (DOM aangemaakt in de init-IIFE), footer-knop `#svr-favorites-reset-btn` ("Wis favorieten")
- `renderFavoritesOverlayContent` filtert `window.staticCampsites` op de opgeslagen id's — favorieten van campings buiten de huidige dataset tonen geen kaart
- Menu-item: `#menu-favorites` in `toggleMapMenu` ("Toon favorieten")

---

## Development Conventions

- **UI-teksten** in het Nederlands, **code-identifiers** in het Engels
- JavaScript: ES6+, IIFE-encapsulatie; **geen comments toevoegen** tenzij gevraagd
- **Commits:** conventional commits met versie-suffix, bijv. `feat(list): campingnaam klikbaar naar detailpagina (v1.6.3)`
- **Versie omhoog** bij elke commit van functionele code (zie Versioning hierboven)
- **Commit/push alleen na expliciete vraag** van de gebruiker

---

## Known Issues / Aandachtspunten

1. **Service-worker-updateroute:** sinds v1.6.5 registreert `index.html` met `{ updateViaCache: 'none' }` + éénmalige `controllerchange`-reload, en gebruikt de app-shell fetch `{ cache: 'no-cache' }`. Daarmee wordt een nieuwe SW bij de eerstvolgende reload direct opgepikt i.p.v. pas na de `max-age=600` van GitHub Pages/Fastly. Sinds **v1.6.9** vangt daarnaast een `version.json`-pobe bij opstart de gevallen af waarin de CDN-edge nog byte-identiek oude `sw.js` uitserveert (éénmalige automatische reload bij mismatch).
2. **jQuery** wordt nog deels in `app.js` gebruikt; verdere modernisering in overleg.
3. **Install-prompt:** `beforeinstallprompt` vuurt eenmalig per origin; daarna handmatige fallback via het ⓘ-helpicoon.
4. **CORS:** de app-origin verschilt van de backend. Als de detailpagina na een deploy niet laadt, controleer de CORS-headers van de Worker.
5. **Offline:** zoeken/filteren/detail vereisen live API-toegang; alleen de UI toont een nette "geen internetverbinding"-melding (bewuste keuze).

---

## Geport uit de hoofd-PWA (v1.6.4 + v1.6.9)

In v1.6.4 zijn vanuit `SVRpwa/` geport: favorieten (opslag, hartje, overlay, wis-knop, menu-item), campingnaam-zoek (plaats-eerst + naamsuggesties, min. 3 tekens), `#searchResetBtn`, single-camping zoom-fix en de bijbehorende CSS/z-index-aanpassingen. Zie commit `156f347`.

In **v1.6.9** is de `version.json`-pobe geport (commit `9b09028`): bij opstart wordt de serverversie vergeleken met `window.SVR_PWA_VERSION`; bij mismatch → toast + éénmalige automatische reload, onafhankelijk van de SW-update-timing en de Fastly-CDN-edge.

In **v1.6.14** (geport uit hoofd-PWA v0.2.89) zijn de tablet-layoutfixes overgenomen (commit `402c9a8`):
- `manifest.json`: `"orientation": "portrait"` verwijderd — geïnstalleerde PWA draait nu vrij mee, zodat tablets liggend de desktop 2-pane-view krijgen (telefoons behouden de portrait-UX via `#portrait-lock`).
- `js/app.js`: mobiele overlay-media-query (`#svr-filter-overlay`/`#svr-favorites-overlay`) verruimd van `max-width: 767px` naar `@media (max-width: 1023px), (orientation: portrait)` — geen unstyled gat meer op 768–1023px (bv. 1280×800-tablet in portrait).
