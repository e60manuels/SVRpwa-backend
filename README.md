# SVRpwaB

**SVRpwaB** is een Progressive Web App (PWA) voor het vinden van SVR-campings
(campings bij de boer) in Nederland en omstreken. Deze app is gebouwd als een
**snellere variant** van de originele SVRpwa: hij draait op een nieuwe,
dedicated backend (`SVRpwa-backend`) in plaats van op de schraap-achterkant van
svr.nl, waardoor zoeken, filteren en het laden van detailpagina's merkbaar
sneller zijn.

> **Doel van dit project:** laten zien hoe snel een SVR-campings PWA kan
> werken, met een moderne data-backend.

---

## Snelle start

```bash
# Serveer de map als statische site (één van de drie):
python -m http.server 8000
npx serve .
php -S localhost:8000
```

Open daarna `http://localhost:8000` in een browser.

## Live

- **Productie (GitHub Pages):** <https://e60manuels.github.io/SVRpwa-backend/>
- **Git remote:** `origin` → `https://github.com/e60manuels/SVRpwa-backend.git`

Deploy gebeurt automatisch via GitHub Pages zodra er naar `main` wordt gepusht.

---

## Kenmerken

- **Kaartweergave** — interactieve Leaflet-kaart met marker-clustering
- **Lijstweergave** — scrollbare lijst met campingkaarten
- **Zoeken** — op plaatsnaam via Nederlandse gemeentedata
- **Filters** — op land en faciliteiten (kampeerplaatsen, verhuur, campers,
  soorten, natuur, huisdieren, voorzieningen, tarieven)
- **Detailpagina's** — snelle weergave met in-memory cache
- **PWA** — installeerbaar, offline fallback, service worker caching
- **Desktop split-screen** — kaart links (60%), lijst/paneel rechts (40%)

---

## Architectuur

- **Type:** statische PWA (geen build-stap, vanilla JavaScript)
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (jQuery voor een deel van de DOM)
- **Kaart:** Leaflet 1.9.4 + Leaflet.markercluster
- **Data-backend:** `https://svr-backend.e60-manuels.workers.dev` (Cloudflare
  Worker)
- **Live data via API** — zoekresultaten, filters en details worden realtime
  opgehaald (niet voorgecachet)

### API-endpoints (svr-backend)

| Endpoint                        | Doel                                    |
| ------------------------------- | --------------------------------------- |
| `GET /api/objects`              | Campings ophalen (met zoek/filterparams)|
| `GET /api/objects/{objectId}`   | Detailgegevens van één camping          |
| `GET /api/filter-data`          | Filteropties en categorieën             |

---

## Directorystructuur

```
SVRpwaB/
├── index.html              # App-entry
├── manifest.json           # PWA-manifest
├── sw.js                   # Service worker (offline caching)
├── offline.html            # Offline-fallbackpagina
├── README.md               # Dit bestand
│
├── css/
│   ├── local_style.css     # Hoofdstyles
│   ├── custom_styles.css   # Aanvullende overrides
│   ├── MarkerCluster.css   # Leaflet-clustering
│   └── MarkerCluster.Default.css
│
├── js/
│   ├── config.js           # Configuratie (API-base, app-versie)
│   ├── app.js              # Hoofdlogica (~2400 regels)
│   ├── pwa_install.js      # Install-bannerlogica
│   └── leaflet.markercluster.js  # Clustering-plugin
│
└── assets/                 # (gemeentedata e.d.)
    icons/                  # PWA-iconen
    fonts/                  # Befalow-lettertype
```

---

## Caching en versies

| Aspect           | Waarde                              |
| ---------------- | ----------------------------------- |
| App-versie       | `window.SVR_PWA_VERSION` (`v1.6.3`) |
| SW-cache         | `svr-pwa-b-v1.6.3`                  |
| Kaart-tile-cache | `svr-pwa-b-tiles`                   |

**Strategie:**
- **App-shell** → network-first met cache-fallback
- **Statische assets** → cache-first (met `ignoreSearch` i.v.m. cache-busting)
- **Kaarttegels (OSM)** → cache-first
- **API-calls** → network-only (altijd live)

**Bij elke wijziging** moeten de volgende versies gesynchroniseerd worden
omgehoog, zodat clients de nieuwe code binnenkrijgen:
`js/config.js`, `js/app.js`, `sw.js` (cache-naam) en de `?v=`-query-string in
`index.html`.

---

## Ontwikkelconventies

- **UI-teksten** in het Nederlands, **code-identifiers** in het Engels
- **JavaScript:** ES6, IIFE-encapsulatie waar van toepassing
- **Versiebeheer:** versie omhoog bij elke commit (zie tabel hierboven)
- **Deploy:** `git push origin main`

---

## Bekende punten / opmerkingen

1. **jQuery** wordt nog gebruikt in `app.js`; een deel is al naar native DOM
   omgezet (detaillogica). Verdere modernisering is apart te plannen.
2. **Installeerbaarheid:** de native install-prompt (`beforeinstallprompt`)
   verschijnt eenmalig per browser/origin; na het al-installeren is een
   handmatige fallback nodig (via het ⓘ-helpicoon).
3. **CORS:** de app draait op een andere origin dan de backend
   (`svr-backend.e60-manuels.workers.dev`). Mocht de detailpagina niet laden na
   een deploy, controleer dan de CORS-instellingen van de backend.
4. **Cache-prefix:** is hernoemd van `svr-pwa-a` naar `svr-pwa-b` (uitgevoerd).