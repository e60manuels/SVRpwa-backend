// VERSION COUNTER - UPDATE THIS WITH EACH COMMIT FOR VISIBILITY
// VERSION COUNTER - geef de juiste versie door (config.js overschrijft dit later)
window.SVR_PWA_VERSION = "1.6.3"; // Increment this number with each commit

// In-memory cache voor detail-pagina's (voorkomt herhaalde cross-origin fetch)
window._detailCache = {};

// [SECTION: INITIALIZATION]
(function () {
    // Typewriter effect for splash screen (now using CSS class)
    function typewriterEffect(elementId, text) {
        const targetElement = document.getElementById(elementId);
        if (!targetElement) return;

        targetElement.textContent = text;
        targetElement.classList.remove('typewriter');
        void targetElement.offsetWidth; // Force reflow to restart animation
        targetElement.classList.add('typewriter');
    }
    window.typewriterEffect = typewriterEffect; // Expose globally

    if (window.SVR_FILTER_OVERLAY_INJECTED) return;
    window.SVR_FILTER_OVERLAY_INJECTED = true;

    // Static data storage - The SINGLE SOURCE OF TRUTH for markers and filters
    window.staticCampsites = null;
    window.filterCategories = {}; // id -> category_name

    // Flag to track if we already have some data on screen
    window.hasDataOnScreen = false;

    // Introduce a flag to control PWA prompt visibility after help overlay interaction
    window.shouldShowPWAAfterHelp = false; // Initialize the flag

    // --- DEBUG LOGGING ---
    function logDebug(msg) {
        console.log(`[v${window.SVR_PWA_VERSION}] ${msg}`);
    }
    window.logDebug = logDebug;
    logDebug("SVR PWA v2.5 Start");

    // --- DATA LOADING LOGIC ---
    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\\/+^])/g, '\\$1') + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }

    window.fetchCampingObjects = async function(sLat, sLng) {
        // Bouw de API URL op basis van geo/search/filters cookies
        const params = [];

        // Bepaalde het zoekcentrum: expliciet meegegeven centrum heeft voorrang,
        // anders de geo_ cookie (zoals in de statische frontend), anders Nederland.
        let useLat = sLat, useLng = sLng, useRadius = 500;
        if ((useLat === null || useLat === undefined) && (useLng === null || useLng === undefined)) {
            const geoCookie = getCookie('geo_info');
            let geo = null;
            try { geo = JSON.parse(geoCookie); } catch (e) {}
            if (geo && geo.lat && geo.lon) {
                useLat = parseFloat(geo.lat); useLng = parseFloat(geo.lon);
                useRadius = geo.country_code === 'nl' ? 30 : 150;
            } else {
                useLat = 52.1326; useLng = 5.2913;
            }
        }
        if (typeof useLat !== 'number' || typeof useLng !== 'number') { useLat = 52.1326; useLng = 5.2913; }

        params.push('lat=' + useLat, 'lng=' + useLng, 'radius=' + useRadius);

        const searchFree = getCookie('search_free');
        if (searchFree) {
            try {
                const sf = JSON.parse(searchFree);
                if (Array.isArray(sf) && sf.length > 0 && sf[0]) params.push('search=' + encodeURIComponent(sf[0]));
            } catch (e) {}
        }

        // Filters: guids in currentFilters vertalen naar API params
        const p = window.filterParamsFromGuids ? window.filterParamsFromGuids(window.currentFilters || []) : { country: null, facilities: [], tarcatLaag: [], tarcatHoog: [] };
        if (p.country) params.push('country=' + encodeURIComponent(p.country));
        if (p.facilities && p.facilities.length > 0) params.push('facilities=' + encodeURIComponent(p.facilities.join(',')));
        if (p.tarcatLaag && p.tarcatLaag.length > 0) params.push('tarcat_laag=' + encodeURIComponent(p.tarcatLaag.join(',')));
        if (p.tarcatHoog && p.tarcatHoog.length > 0) params.push('tarcat_hoog=' + encodeURIComponent(p.tarcatHoog.join(',')));

        let url = (window.API_BASE || 'https://svr-backend.e60-manuels.workers.dev') + '/api/map-objects?';
        url += params.join('&');

        logDebug('API laden: ' + url);
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const raw = data.objects || [];

        // Map naar het formaat dat renderResults verwacht
        return raw.map(obj => {
            const coords = obj.geometry.coordinates;
            const lat = coords[1], lng = coords[0];
            return {
                id: obj.id,
                geometry: { coordinates: [lng, lat] },
                properties: {
                    name: obj.properties.name,
                    adres: obj.properties.adres || null,
                    address: obj.properties.adres || null,
                    city: obj.properties.city || '',
                    type_camping: parseInt(obj.properties.type_camping) || 0,
                    lat: lat,
                    lng: lng
                },
                distM: calculateDistance(useLat, useLng, lat, lng)
            };
        });
    };

    window.loadStaticCampsites = async function() {
        performance.mark('data-load-start');
        try {
            // Plaats de rode punaise direct op de startlocatie (Nederland)
            const startLat = 52.1326, startLng = 5.2913;
            if (centerMarker) map.removeLayer(centerMarker);
            centerMarker = L.marker([startLat, startLng], { 
                icon: L.divIcon({ 
                    className: 'search-marker', 
                    html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>', 
                    iconSize:[30,30], 
                    iconAnchor:[15,30] 
                }),
                zIndexOffset: 2000 
            }).addTo(map);

            logDebug("Laden van campingdata via API (Unified Delivery)...");
            const objects = await window.fetchCampingObjects(startLat, startLng);
            objects.sort((a, b) => a.distM - b.distM);
            window.staticCampsites = objects;

            // Direct renderen (gebruik skipFitBounds om verspringen te voorkomen bij start)
            window.skipFitBounds = true;
            renderResults(objects, startLat, startLng);
            window.skipFitBounds = false;
            
            window.hasDataOnScreen = true;
            logDebug(`Campingdata geladen en gerenderd: ${objects.length} campings.`);
            return true;
        } catch (e) {
            logDebug("Static Data Fout: " + e.message);
        } finally {
            performance.mark('data-load-end');
            performance.measure('Unified Data Loading', 'data-load-start', 'data-load-end');
        }
        return false;
    };

    // [SECTION: CSV_SEARCH_LOGIC]
    window.allLocations = [];
    async function loadLocations() {
        try {
            const res = await fetch('assets/Woonplaatsen_in_Nederland.csv');
            const text = await res.text();
            const lines = text.split('\n');
            window.allLocations = lines.slice(1).map(line => {
                const parts = line.split(';');
                if (parts.length >= 2) return { name: parts[0].trim(), province: parts[1].trim() };
                return null;
            }).filter(l => l && l.name);
            logDebug("CSV OK: " + window.allLocations.length);
        } catch (e) { logDebug("CSV Fout: " + e.message); }
    }
    loadLocations();

    window.getSuggestionsLocal = function(q) {
        const queryLower = q.toLowerCase().trim();
        return window.allLocations.filter(l => 
            l.name.toLowerCase().startsWith(queryLower) || 
            l.name.toLowerCase().includes(" " + queryLower)
        ).slice(0, 10).map(l => `${l.name} (${l.province})`);
    };

    window.getCoordinatesWeb = async function(place) {
        const locationName = place.includes(" (") ? place.split(" (")[0] : place;
        try {
            // If the place name is not in our local Dutch list and doesn't already have a country suffix, 
            // search globally. Otherwise, prefer Netherlands for common names.
            let query = locationName;
            const isLocal = window.allLocations.some(l => l.name.toLowerCase() === locationName.toLowerCase());
            if (isLocal && !locationName.includes(",")) {
                query += ", Nederland";
            }

            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
            logDebug(`Fetching coordinates for "${query}" via Worker proxy.`);
            const contents = await fetchWithRetry(nominatimUrl); // Use fetchWithRetry
            const data = JSON.parse(contents);
            if (data && data.length > 0) {
                return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
            }
        } catch (e) { logDebug("Geocode Fout: " + e.message); }
        return null;
    };

    // [SECTION: NETWORK_PROXY]
    window.proxyUrl = function(url, provider = 'ao') {
        if (provider === 'ao') return "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
        return "https://corsproxy.io/?" + encodeURIComponent(url);
    }

    async function fetchWithRetry(url) {
        logDebug("Fetch (direct): " + url);
        try {
            const res = await fetch(url, { headers: { 'Accept': 'application/json, text/html' } });
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`HTTP error! Status: ${res.status}, Response: ${errorText}`);
            }
            return await res.text();
        } catch (e) {
            logDebug("Fetch mislukt: " + e.message);
            return "";
        }
    }    window.fetchWithRetry = fetchWithRetry;

    window.openNavHelper = function(lat, lng, nameEnc) {
        try {
            const name = decodeURIComponent(escape(window.atob(nameEnc)));
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            window.open(url, '_blank');
        } catch(e) { logDebug("Nav Fout: " + e.message); }
    };

    const css = `
        #svr-filter-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1400; display: none; opacity: 0; transition: opacity 0.3s ease; }
        #svr-filter-backdrop.open { display: block; opacity: 1; }
        
        /* MOBILE STYLES (default) */
        @media (max-width: 767px) {
            #svr-filter-overlay {
                position: fixed; bottom: 0; left: 0; width: 100%; height: 90vh;
                background-color: #f0f0f0; z-index: 9995; display: flex; flex-direction: column;
                box-sizing: border-box; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
                border-top-left-radius: 12px; border-top-right-radius: 12px; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
            }
            #svr-filter-overlay.open { transform: translateY(0); }
            .svr-overlay-header { 
                background-color: #f0f0f0; 
                padding: 8px 15px 12px 15px; 
                display: flex; 
                flex-direction: row;
                align-items: center; 
                justify-content: space-between;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
                cursor: ns-resize; 
            }
            .svr-overlay-header > div:first-child {
                display: none !important;
            }
            .svr-overlay-title { 
                margin: 0;
                text-align: left;
                flex: 1;
            }
            .svr-overlay-close {
                width: 32px; 
                height: 32px; 
                background: transparent;
                border-radius: 50%; 
                display: flex; 
                align-items: center;
                justify-content: center; 
                cursor: pointer; 
                color: #333;
                flex-shrink: 0;
            }
        }

        /* SHARED STYLES (Both Mobile & Desktop) */
        .svr-overlay-title { font-size: 1.2rem; font-weight: bold; margin: 0; color: #008AD3; font-family: 'Befalow', sans-serif; text-align: left; }
        #svr-filter-overlay-content { flex-grow: 1; overflow-y: auto; width: 100%; background-color: #f0f0f0; padding: 15px; box-sizing: border-box; scroll-behavior: smooth; }
        #active-filters-holder { background: #FDCC01; border-radius: 12px; padding: 12px 15px; margin-bottom: 15px; display: none; box-sizing: border-box; width: 100%; position: sticky; top: 0; z-index: 100; }
        .active-filter-tag { display: inline-flex; align-items: center; background: white; padding: 4px 10px; border-radius: 15px; margin: 4px; font-size: 12px; font-weight: bold; color: #008AD3; border: 1px solid #ddd; }
        .filter-section-card { background: white; border-radius: 12px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); overflow: visible !important; }
        .filter-section-header { 
            padding: 12px 15px; 
            background: #FDCC01; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            cursor: pointer; 
            position: sticky; 
            top: calc(var(--filters-height, 0px) - 15px); 
            z-index: 10; 
        }
        .filter-section-header h4 { margin: 0; font-size: 22px; color: #333; font-family: 'Befalow', sans-serif; }
        .filter-section-body { padding: 0 15px; display: none; }
        .filter-section-body.show { display: block; padding-bottom: 10px; }
        .svr-overlay-footer { padding: 12px 15px; border-top: 1px solid #ddd; display: flex; gap: 15px; background: #f0f0f0; }
        .svr-footer-btn { flex: 1; height: 40px; border-radius: 20px; font-size: 0.9rem; font-weight: bold; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #svr-filter-apply-btn { background-color: #FDCC01; color: #333; }
        #svr-filter-reset-btn { background-color: white; color: #c0392b; border: 1px solid #ddd; }
        .filter-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f9f9f9; }
        
        /* Filter Sub-Dropdown Styles */
        .filter-sub-toggle { 
            padding: 10px 0; border-bottom: 1px solid #f9f9f9; cursor: pointer; 
            display: flex; justify-content: space-between; align-items: center; 
            font-size: 15px; color: #333; 
        }
        .filter-sub-toggle i { transition: transform 0.3s ease; color: #008AD3; }
        .filter-sub-toggle.active i { transform: rotate(90deg); }
        .filter-sub-content { display: none; padding-left: 20px; background: #fafafa; }
        .filter-sub-content.show { display: block; }
        
        .filters-nav-container {
            position: relative; /* Ensure positioning context for absolute children */
            display: flex; /* Make it a flex container */
            align-items: center; /* Vertically center content */
            overflow: hidden; /* Hide overflowing content, especially for scrolling chips */
            width: 100%; /* Take full width of parent */
            height: 36px; /* Explicitly set height */
        }
        
        .active-filters-bar {
            position: relative; /* Positioning context for arrows */
            flex: 1; /* Ensure it takes all available horizontal space */
            height: 100%; /* Take full height of parent */
            overflow-x: auto; /* Re-enable */
            white-space: nowrap; /* Re-enable */
            padding: 0 40px; /* Space for arrows */
            box-sizing: border-box;
            display: flex;
            align-items: center;
            scrollbar-width: none;
            scroll-behavior: smooth;
        }

        .filter-nav-arrow {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.8);
            border: none;
            padding: 0 5px;
            cursor: pointer;
            height: 100%; /* Take full height of active-filters-bar */
            display: flex;
            align-items: center;
            z-index: 1;
            font-size: 1.2rem;
            color: var(--svr-blue);
            opacity: 0;
            transition: opacity 0.2s;
        }
        .filter-nav-arrow.visible {
            opacity: 1;
        }
        .filter-nav-arrow.left {
            left: 0;
            border-right: 1px solid rgba(0,0,0,0.1);
        }
        .filter-nav-arrow.right {
            right: 0;
            border-left: 1px solid rgba(0,0,0,0.1);
        }

        /* DESKTOP SPECIFIC (min-width: 768px) */
        @media (min-width: 768px) {
            #svr-filter-overlay { 
                display: flex; flex-direction: column; background-color: #f0f0f0; 
                border-radius: 0; transform: none !important; transition: none !important;
                overflow: hidden;
            }
            .svr-overlay-header { 
                background-color: var(--svr-yellow) !important; padding: 15px 20px; 
                display: flex !important; flex-direction: row !important; 
                align-items: center; justify-content: space-between; 
                border-bottom: 1px solid rgba(0,0,0,0.1); flex-shrink: 0;
                height: 60px; box-sizing: border-box;
            }
            /* Hide the drag handle div explicitly */
            .svr-overlay-header > div:first-child { display: none !important; }
            
            .svr-overlay-title { padding: 0; margin: 0; color: #333 !important; font-size: 1.3rem; flex-grow: 1; text-align: left; }
            .svr-overlay-close { 
                width: 32px; height: 32px; background: rgba(0,0,0,0.1); 
                border-radius: 50%; display: flex; align-items: center; 
                justify-content: center; cursor: pointer; color: #333; 
                transition: background 0.2s; flex-shrink: 0;
            }
            .svr-overlay-close:hover { background: rgba(0,0,0,0.2); }

            /* Sticky categorie-headers voor een betere UX */
            .filter-section-card { overflow: visible !important; }
            .filter-section-header { 
                position: sticky !important; 
                top: calc(var(--filters-height, 0px) - 15px) !important; 
                z-index: 10 !important; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }

            /* Content scrollable maken zonder header te pushen */
            #svr-filter-overlay-content {
                flex: 1 1 auto;
                overflow-y: auto !important;
                background-color: #f8f8f8;
            }
            .svr-overlay-footer {
                flex-shrink: 0;
                background-color: #f0f0f0;
            }

            /* Specific styles for active filter bar within injected CSS */
            .filters-nav-container {
                width: calc(100% - 24px); /* Account for svr-header's 12px horizontal padding on each side */
                margin: 0 auto; /* Center it */
                /* height and other properties remain from general styles */
            }

            .active-filters-bar {
                justify-content: flex-end;
                /* padding-right handled by local_style.css for desktop alignment */
                padding-left: 40px; /* Space for arrow */
            }

            /* Spacing between chips */
            .active-filters-bar .active-filter-chip {
                margin-right: 8px;
                margin-left: 0;
            }

            /* No specific positioning for arrows here, general styles apply */
        }
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);

    const backdrop = document.createElement('div'); backdrop.id = 'svr-filter-backdrop'; document.body.appendChild(backdrop);
    const overlay = document.createElement('div'); overlay.id = 'svr-filter-overlay';
    overlay.innerHTML = `
        <div class="svr-overlay-header" id="filter-drag-header">
            <div style="width: 100%; display: flex; justify-content: center; margin-bottom: 10px; pointer-events: none;"><div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px;"></div></div>
            <h3 class="svr-overlay-title">Filters</h3>
            <div class="svr-overlay-close" onclick="window.closeFilterOverlay()"><i class="fas fa-times"></i></div>
        </div>
        <div id="svr-filter-overlay-content">
            <div id="active-filters-holder"><div id="active-tags-container"></div></div>
            <div id="filter-loading" style="text-align:center; padding: 40px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#008AD3"></i><p>Filters ophalen...</p></div>
            <div id="filter-container"></div>
        </div>
        <div class="svr-overlay-footer">
            <button id="svr-filter-reset-btn" class="svr-footer-btn">Wis filters</button>
            <button id="svr-filter-apply-btn" class="svr-footer-btn">Toepassen</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const content = overlay.querySelector('#filter-container');
    const loading = overlay.querySelector('#filter-loading');

    // Generic Swipe-to-Close Logic
    window.enableSwipeToClose = function(element, closeCallback, dragHandleSelector) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        const dragHandle = element.querySelector(dragHandleSelector || '.svr-overlay-header, .detail-header');

        if (!dragHandle) return;

        dragHandle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
            element.style.transition = 'none'; // Disable transition for direct tracking
        }, {passive: true});

        dragHandle.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0) { // Only allow dragging downwards
                e.preventDefault(); // Prevent scrolling
                element.style.transform = `translateY(${deltaY}px)`;
            }
        }, {passive: false});

        dragHandle.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            element.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)'; // Restore transition
            
            const deltaY = currentY - startY;
            const threshold = 100; // Pixel threshold to close

            if (deltaY > threshold) {
                element.style.transform = 'translateY(100%)'; // Visual close immediately
                setTimeout(() => {
                    closeCallback(); // Trigger full cleanup after animation start
                }, 10);
            } else {
                element.style.transform = 'translateY(0)'; // Snap back
            }
            startY = 0;
            currentY = 0;
        });
    };

window.hideFilterOverlay = function() {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
    }
    const isDesktop = window.innerWidth >= 768;
    const filterEl = document.getElementById('svr-filter-overlay');
    const backdropEl = document.getElementById('svr-filter-backdrop');

    if (isDesktop) {
        closeRightPanel();
        filterEl.style.display = 'none';
        filterEl.classList.remove('open');
    } else {
        filterEl.classList.remove('open');
        backdropEl.classList.remove('open');
        filterEl.style.transform = '';
        setTimeout(() => {
            if (!filterEl.classList.contains('open')) {
                backdropEl.style.display = 'none';
            }
        }, 500);
    }
};

    window.closeFilterOverlay = function() { 
        // If we are in the 'filters' or 'detail' history state, going back will trigger onpopstate
        // which will call hideFilterOverlay() or handle the detail close animation.
        if (history.state && (history.state.view === 'filters' || history.state.view === 'detail')) {
            history.back();
        } else {
            // Fallback if state is already gone
            window.hideFilterOverlay();
        }
    };
    backdrop.onclick = window.closeFilterOverlay;

    // Enable swipe for filter overlay
    window.enableSwipeToClose(overlay, window.closeFilterOverlay, '.svr-overlay-header');

    window.toggle_filters = async function() {
        const isDesktop = window.innerWidth >= 768;

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: true }, '*');
        }

        if (isDesktop) {
            const filterEl = document.getElementById('svr-filter-overlay');
            
            // Toggle: als filter al open is, sluit het
            if (document.body.classList.contains('panel-open') && filterEl.style.display === 'block') {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
                }
                closeRightPanel();
                return;
            }

            // Open filter rechts
            openRightPanel('filter');
            filterEl.classList.add('open');

            // Push state voor backknop
            history.pushState({ view: 'filters' }, "");

            if (content.children.length === 0 && !window.isFetchingFilters) await fetchFilterData();
        } else {
            // Mobile: fullscreen overlay met backdrop
            backdrop.style.display = 'block';
            overlay.style.transform = '';
            setTimeout(() => { overlay.classList.add('open'); backdrop.classList.add('open'); }, 10);
            history.pushState({ view: 'filters' }, "");
            if (content.children.length === 0 && !window.isFetchingFilters) await fetchFilterData();
        }
    };

    window.isFetchingFilters = false;
// Filterlay-out exact volgens de originele PWA: 2 secties
    // ('Zoek op land' en 'Populaire faciliteiten'), met de overige
    // categorieën als inklapbare sub-dropdowns (.filter-sub-toggle).
    // Opties worden gevuld uit de daadwerkelijke data (via /api/filter-data),
    // zodat elke optie in de API ook echt matcht en er niets ontbreekt.
    const PRIMARY_COUNTRIES = ['Nederland', 'Frankrijk', 'Duitsland', 'Portugal', 'Tsjechië'];

    const POPULAR_FACILITIES = ['Kindercamping', 'Prive sanitair', 'Viswater op de camping', 'WiFi', 'Wintercamping', 'Zwemwater in omgeving'];

    const FACILITY_GROUPS = [
        { title: 'Kampeerplaatsen', items: ['6 Ampère', '10 Ampère', '16 Ampère', 'Alleen tent kamperen', 'Tot 20 kampeerplaatsen', '> 20 kampeerplaatsen', '> 40 kampeerplaatsen', 'Seizoensplaatsen', 'Verharde kampeerplaatsen', 'Wateraansluiting op kampeerplts.', 'Waterafvoer op kampeerplts.', 'Trekkersveld tent aanw.'] },
        { title: 'Verhuur(accommodaties)', items: ['Huren hele jaar mogelijk', 'Verhuur met eigen sanitair', 'Alleen iets te huur', 'Appartement', 'Bed & Breakfast', 'Groepsruimte meer dan 20 personen', 'Groepsruimte tot 20 personen', 'Huren tot 2 personen', 'Huren tot 4 personen', 'Huren meer dan 4 personen', 'Kamer', '(Sta) Caravan', '(Safari)Tent', 'Trekkershut/ Chalet', 'Vakantiehuis(je)'] },
        { title: 'Campers', items: ['Alleen camperplaatsen', 'Campers welkom > 7.50m', 'Campers welkom < 7.50m', 'Loosplaats camper', 'Verharde camperplaatsen'] },
        { title: 'Soort camping', items: ['Adults only', 'Autovrije camping', 'Bio / Ecologisch', 'Boerderij', 'Fien en Teun camping', 'Geen boerderij', 'Naturistencamping'] },
        { title: 'Natuur/ Ligging', items: ['Bergen in omgeving', 'Bos in omgeving', 'Vaarwater op de camping', 'Viswater in omgeving', 'Zee in de omgeving', 'Zwemwater op camping'] },
        { title: 'Faciliteiten', items: ['Broodjesservice', 'Sauna', 'Speelgelegenheid'] },
        { title: 'Huisdieren', items: ['Huisdieren niet toegestaan', 'Huisdier welkom', 'Huisdieren toegestaan in verhuuracc.'] },
        { title: 'Voorzieningen', items: ['Dagelijkse voorzieningen in omg.', 'Eetgelegenheid', 'Laadpaal elektr. auto', 'Manege in omgeving', 'Openbaar vervoer', 'Paarden welkom', "Paardenpony's aanwezig", 'Pinnen mogelijk', 'Recreatieruimte', 'Rolstoeltoegankelijk sanitair', 'Terras', 'Voorzieningen mindervaliden', 'Winterstalling'] },
        { title: 'Tarieven', items: [] }
    ];

    // Tarieven-filters exact zoals op svr.nl. De eerste drie horen bij het
    // laagseizoen (tar_cat_laag), de laatste drie bij het hoogseizoen
    // (tar_cat_hoog): 1 munt = lager, 2 munten = gelijk, 3 munten = hoger
    // dan het SVR-richttarief.
    const TARIEVEN_OPTIONS = [
        { name: '€  -  lager dan het SVR-richttarief', tarcat: 'laag', value: 1 },
        { name: '€€ - gelijk aan het SVR-richttarief', tarcat: 'laag', value: 2 },
        { name: '€€€ - hoger dan het SVR-richttarief', tarcat: 'laag', value: 3 },
        { name: '€ - lager dan het SVR-richttarief', tarcat: 'hoog', value: 1 },
        { name: '€€ - gelijk aan het SVR-richttarief', tarcat: 'hoog', value: 2 },
        { name: '€€€ - hoger dan het SVR-richttarief', tarcat: 'hoog', value: 3 }
    ];

    // Dynamische guid -> API param lookup, gevuld zodra de filterdata geladen is
    window._filterLookup = null;

    // Vertaal geselecteerde guids naar API params (country + facilities + tariefcategorie)
    window.filterParamsFromGuids = function(guids) {
        const result = { country: null, facilities: [], tarcatLaag: [], tarcatHoog: [] };
        const lookup = window._filterLookup || {};
        (guids || []).forEach(guid => {
            const api = lookup[guid];
            if (!api) return;
            if (api.country && !result.country) result.country = api.country;
            if (api.facility && !result.facilities.includes(api.facility)) result.facilities.push(api.facility);
            if (api.tarcat === 'laag' && !result.tarcatLaag.includes(api.value)) result.tarcatLaag.push(api.value);
            if (api.tarcat === 'hoog' && !result.tarcatHoog.includes(api.value)) result.tarcatHoog.push(api.value);
        });
        return result;
    };

    async function fetchFilterData() {
        if (window.isFetchingFilters) return;
        window.isFetchingFilters = true;
        try {
            logDebug("Filterdata ophalen via API...");
            const apiBase = window.API_BASE || 'https://svr-backend.e60-manuels.workers.dev';
            const res = await fetch(apiBase + '/api/filter-data');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const filterData = await res.json();

            const countries = (filterData.countries || []).filter(c => c && c.name);
            const facilities = (filterData.facilities || []).filter(f => f && f.name);
            const facByName = {};
            facilities.forEach(f => { facByName[f.name] = f; });
            const countryByName = {};
            countries.forEach(c => { countryByName[c.name] = c; });

            loading.style.display = 'none';
            content.innerHTML = '';

            // Bouw exact 2 secties zoals in de originele PWA:
            // 1) 'Zoek op land' (primair + 'Overige landen'-subdropdown)
            // 2) 'Populaire faciliteiten' (populaire items + faciliteitgroepen als subdropdowns)
            const lookup = {};
            let guidCounter = 1;

            const makeItem = (name, api) => {
                const guid = 'g' + (guidCounter++);
                lookup[guid] = api;
                return { name, guid };
            };
            const countryItem = (name) => makeItem(name, { country: name });
            const facItem = (f) => makeItem(f.name, { facility: f.raw || f.name });
            const tarcatItem = (o) => makeItem(o.name, { tarcat: o.tarcat, value: o.value });

            const SECTIONS = [
                {
                    title: 'Zoek op land',
                    open: false,
                    items: PRIMARY_COUNTRIES.filter(n => countryByName[n]).map(countryItem),
                    subGroups: [
                        { title: 'Overige landen', items: countries.filter(c => PRIMARY_COUNTRIES.indexOf(c.name) === -1).map(c => countryItem(c.name)) }
                    ]
                },
                {
                    title: 'Populaire faciliteiten',
                    open: true,
                    items: POPULAR_FACILITIES.filter(n => facByName[n]).map(n => facItem(facByName[n])),
                    subGroups: FACILITY_GROUPS.map(g => ({
                        title: g.title,
                        items: g.title === 'Tarieven'
                            ? TARIEVEN_OPTIONS.map(tarcatItem)
                            : g.items.filter(n => facByName[n]).map(n => facItem(facByName[n]))
                    })).filter(g => g.items.length > 0)
                }
            ].filter(s => s.items.length > 0 || s.subGroups.length > 0);

            window._filterLookup = lookup;

            const escapeHtml = (s) => String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

            const addItem = (body, item) => {
                const checked = (window.currentFilters || []).includes(item.guid) ? 'checked' : '';
                const div = document.createElement('div');
                div.className = 'filter-item';
                div.innerHTML = `<input type="checkbox" value="${item.guid}" ${checked} onchange="window.onFilterChange()"><label style="flex-grow: 1; cursor: pointer;" onclick="this.previousElementSibling.click()">${escapeHtml(item.name)}</label>`;
                body.appendChild(div);
            };

            const addSubGroup = (body, group) => {
                const toggle = document.createElement('div');
                toggle.className = 'filter-sub-toggle';
                toggle.innerHTML = `<span>${escapeHtml(group.title)}</span><i class="fas fa-caret-right"></i>`;
                const subContent = document.createElement('div');
                subContent.className = 'filter-sub-content';
                group.items.forEach(item => addItem(subContent, item));
                toggle.onclick = () => {
                    toggle.classList.toggle('active');
                    subContent.classList.toggle('show');
                };
                body.appendChild(toggle);
                body.appendChild(subContent);
            };

            SECTIONS.forEach(section => {
                const sectionCard = document.createElement('div');
                sectionCard.className = 'filter-section-card';

                const header = document.createElement('div');
                header.className = 'filter-section-header';
                header.innerHTML = `<h4>${escapeHtml(section.title)}</h4><i class="fas fa-chevron-down"></i>`;

                const body = document.createElement('div');
                body.className = 'filter-section-body';

                header.onclick = () => {
                    const isOpening = !header.classList.contains('active');
                    header.classList.toggle('active');
                    body.classList.toggle('show');
                    if (isOpening) {
                        setTimeout(() => sectionCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }
                };

                if (section.open) {
                    header.classList.add('active');
                    body.classList.add('show');
                }

                section.items.forEach(item => addItem(body, item));
                section.subGroups.forEach(group => addSubGroup(body, group));

                sectionCard.appendChild(header);
                sectionCard.appendChild(body);
                content.appendChild(sectionCard);
            });

            logDebug("Filters succesvol opgebouwd: " + SECTIONS.length + " secties");
        } catch (e) {
            logDebug("Filter Fout: " + e.message);
            loading.style.display = 'none';
            content.innerHTML = '<div style="padding:20px;text-align:center;">Fout bij ophalen filters</div>';
        } finally {
            window.isFetchingFilters = false;
        }
    }
    // Functie om de navigatiepijltjes van de filterbalk bij te werken
    function updateFilterArrows() {
        const bar = document.getElementById('active-filters-bar');
        const leftArrow = document.getElementById('filter-arrow-left');
        const rightArrow = document.getElementById('filter-arrow-right');
        
        if (!bar || !leftArrow || !rightArrow) return;

        // Check if there is overflow
        const hasOverflow = bar.scrollWidth > bar.clientWidth;
        
        if (!hasOverflow) {
            leftArrow.classList.remove('visible');
            rightArrow.classList.remove('visible');
            return;
        }

        // Show/hide left arrow
        if (bar.scrollLeft > 5) {
            leftArrow.classList.add('visible');
        } else {
            leftArrow.classList.remove('visible');
        }

        // Show/hide right arrow
        // Gebruik een marge van 5px voor afrondingsverschillen
        if (bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 5) {
            rightArrow.classList.add('visible');
        } else {
            rightArrow.classList.remove('visible');
        }
    }

    // Initialiseer de navigatiepijltjes
    function initFilterNav() {
        const bar = document.getElementById('active-filters-bar');
        const leftArrow = document.getElementById('filter-arrow-left');
        const rightArrow = document.getElementById('filter-arrow-right');

        if (bar) {
            bar.addEventListener('scroll', updateFilterArrows);
            // Ook checken bij resize van het venster
            window.addEventListener('resize', updateFilterArrows);
        }

        if (leftArrow) {
            leftArrow.onclick = () => {
                if (bar) bar.scrollBy({ left: -150, behavior: 'smooth' });
            };
        }

        if (rightArrow) {
            rightArrow.onclick = () => {
                if (bar) bar.scrollBy({ left: 150, behavior: 'smooth' });
            };
        }
    }

    // Functie om de actieve filters UI bij te werken
    // target: 'overlay' (menu tags), 'header' (top chips), or 'both'
    function updateActiveFiltersUI(selectedItems, target = 'both') {
        // --- 1. Overlay Tags (Inside the filter menu) ---
        if (target === 'overlay' || target === 'both') {
            const tagsContainer = overlay.querySelector('#active-tags-container');
            const activeHolder = overlay.querySelector('#active-filters-holder');
            const overlayContent = overlay.querySelector('#svr-filter-overlay-content');

            tagsContainer.innerHTML = '';
            const oldHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;

            if (selectedItems.length > 0) {
                activeHolder.style.display = 'block';
                selectedItems.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = 'active-filter-tag';
                    tag.innerText = item.name;
                    tagsContainer.appendChild(tag);
                });
            } else {
                activeHolder.style.display = 'none';
            }

            setTimeout(() => {
                const newHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;
                const diff = newHeight - oldHeight;
                
                // Update dynamic CSS variable for sticky headers
                overlayContent.style.setProperty('--filters-height', newHeight + 'px');

                if (newHeight > 0) {
                    overlayContent.style.scrollPaddingTop = (newHeight + 15) + 'px';
                } else {
                    overlayContent.style.scrollPaddingTop = '15px';
                }
                if (diff !== 0 && overlayContent.scrollTop > 0) {
                    overlayContent.scrollBy({ top: -diff, behavior: 'instant' });
                }
            }, 1);
        }

        // --- 2. Header Chips (Top search bar) ---
        if (target === 'header' || target === 'both') {
            const headerBar = document.getElementById('active-filters-bar');
            const svrHeader = document.querySelector('.svr-header');
            
            if (headerBar) {
                headerBar.innerHTML = '';
                if (selectedItems.length > 0) {
                    document.body.classList.add('has-filters');
                    svrHeader.classList.add('has-filters');
                    selectedItems.forEach(item => {
                        const chip = document.createElement('div');
                        chip.className = 'active-filter-chip';
                        chip.innerHTML = `${item.name}<i class="fas fa-times-circle" data-guid="${item.guid}"></i>`;
                        headerBar.appendChild(chip);

                        chip.querySelector('i').onclick = (e) => {
                            e.stopPropagation();
                            const guid = e.target.getAttribute('data-guid');
                            window.removeFilterByGuid(guid);
                        };
                    });
                    
                    // Check pijltjes na het vullen van de chips
                    setTimeout(updateFilterArrows, 100);
                } else {
                    document.body.classList.remove('has-filters');
                    svrHeader.classList.remove('has-filters');
                }
            }
        }
    }

    /**
     * Verwijdert een enkel filter via de chip en ververst de resultaten.
     */
    window.removeFilterByGuid = function(guid) {
        logDebug(`Verwijderen filter via chip: ${guid}`);
        
        const cb = overlay.querySelector(`input[type="checkbox"][value="${guid}"]`);
        if (cb) cb.checked = false;

        window.currentFilters = (window.currentFilters || []).filter(f => f !== guid);

        const btn = document.getElementById('filterBtn');
        if (window.currentFilters.length === 0) {
            btn.style.background = 'white';
            btn.style.color = '#333';
        }

        const selected = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        // Update BEIDE UI locaties bij handmatige verwijdering
        updateActiveFiltersUI(selected, 'both');

        window.performSearch(true);
    };

    window.onFilterChange = function() {
        const selected = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        // CRITICAL FIX: Update alleen de 'overlay', nog GEEN chips in de header
        updateActiveFiltersUI(selected, 'overlay'); 
    };

    overlay.querySelector('#svr-filter-apply-btn').onclick = function() {
        const selectedGuids = [];
        const selectedItems = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selectedGuids.push(cb.value);
            selectedItems.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        window.currentFilters = selectedGuids;

        const btn = document.getElementById('filterBtn');
        if (selectedGuids.length > 0) {
            btn.style.background = 'var(--svr-blue)';
            btn.style.color = 'white';
        } else {
            btn.style.background = 'white';
            btn.style.color = '#333';
        }

        // NU pas de header chips updaten
        updateActiveFiltersUI(selectedItems, 'header');

        window.closeFilterOverlay();
        window.performSearch(true); 
    };

    // Wis filters functionaliteit
    window.resetFilters = function() {
        overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        window.currentFilters = [];
        const btn = document.getElementById('filterBtn');
        btn.style.background = 'white';
        btn.style.color = '#333';

        // Leeg de UI overal
        updateActiveFiltersUI([], 'both');

        // CRITICAL: Clear cache to prevent "hanging" filter results
        localStorage.removeItem('svr_cache_campsites');

        const expires = "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = "filters=[]; expires=" + expires + "; path=/; domain=svr.nl";

        // Reset URL hash
        if (window.location.hash.includes('detail/')) {
            // Keep detail view if that's what we are looking at
        } else {
            history.replaceState({ view: isListView ? 'list' : 'map' }, "", window.location.pathname);
        }

        window.closeFilterOverlay();
        window.performSearch(true); 
    };

    // Voeg click handler toe aan de reset knop
    overlay.querySelector('#svr-filter-reset-btn').onclick = window.resetFilters;

    window.fetchFilterData = fetchFilterData;

    // Start de navigatiepijltjes logica
    initFilterNav();

})();

// --- MAP & CORE LOGIC ---
let isListView = false;
let isSearching = false;
logDebug("Map init...");
const map = L.map('map', { zoomControl: false }).setView([52.1326, 5.2913], 8);
const markerCluster = L.markerClusterGroup();
const top10Layer = L.featureGroup();
let centerMarker = null;
let currentUserLatLng = null;
let userLocationMarker = null;

// Add zoom control positioned at bottom right (desktop only)
const isDesktop = window.innerWidth >= 768;
if (isDesktop) {
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
}

const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
tiles.on('tileload', () => { if(!window.tilesLogged) { logDebug("Tegels OK"); window.tilesLogged=true; } });
map.addLayer(markerCluster); map.addLayer(top10Layer);

map.on('locationfound', (e) => { 
    if (!currentUserLatLng || currentUserLatLng.distanceTo(e.latlng) > 100) {
        logDebug("Loc: " + e.latlng.lat.toFixed(3) + "," + e.latlng.lng.toFixed(3));
        currentUserLatLng = e.latlng;
    }

    // Update or create user location marker
    if (userLocationMarker) {
        userLocationMarker.setLatLng(e.latlng);
    } else {
        userLocationMarker = L.marker(e.latlng, {
            icon: L.divIcon({
                className: 'user-location-dot',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }),
            zIndexOffset: 1000
        }).addTo(map);
    }
});
map.locate({ watch: false, enableHighAccuracy: true });

$('#locateBtn').on('click', () => {
    if (currentUserLatLng) map.setView(currentUserLatLng, 10);
    else map.locate({ setView: true, maxZoom: 10 });
});

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    const dLat = (lat2-lat1) * Math.PI/180, dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function applyState(state) {
    if (!state) return;
    
    const isDesktop = window.innerWidth >= 768;

    // Only hide detail container if the new state is NOT a detail view
    // This prevents the hide/show flash when updating detail content
    if (state.view !== 'detail') {
        if ($('#detail-container').hasClass('open') && window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        $('#detail-container').hide().removeClass('open');
    }

    // On desktop, don't hide containers - let CSS handle visibility via body classes
    if (!isDesktop) {
        // Hide main containers (mobile only)
        $('#map-container').hide();
        $('#list-container').hide();

        // Reset button visibility
        $('#locateBtn').hide();
        $('#scroll_top_btn').removeClass('visible').hide();
    }

    switch (state.view) {
        case 'list':
            isListView = true;
            if (!isDesktop) {
                $('#list-container').show();
                $('#toggleView i').attr('class', 'fas fa-map');
                $('#scroll_top_btn').addClass('visible').show();
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            break;
        case 'map':
            isListView = false;
            if (!isDesktop) {
                $('#map-container').show();
                $('#toggleView i').attr('class', 'fas fa-list');
                setTimeout(() => {
                    map.invalidateSize();
                    if (window.lastMapBounds) {
                        map.fitBounds(window.lastMapBounds, { padding: [50, 50] });
                    }
                }, 100);
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            // Locate button: show on map view (both mobile and desktop)
            $('#locateBtn').show();
            break;
        case 'detail':
            isListView = false;
            if (!isDesktop) {
                $('#detail-container').show(); // Ensure visible, but showSVRDetailPage handles the 'open' class
            }
            break;
        default:
            isListView = false;
            if (!isDesktop) {
                $('#map-container').show();
                $('#toggleView i').attr('class', 'fas fa-list');
                setTimeout(() => map.invalidateSize(), 100);
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            // Locate button: show on map view (both mobile and desktop)
            $('#locateBtn').show();
            break;
    }
}

// --- SCROLL TO TOP LOGIC ---
$('#list-container').on('scroll', function() {
    const isDesktop = window.innerWidth >= 768;
    if (isListView || isDesktop) {
        if ($(this).scrollTop() > 300) {
            $('#scroll_top_btn').css('opacity', '1');
            // Desktop: toon toggle knop als scroll-to-top
            if (isDesktop) {
                $('#toggleView').addClass('visible').show();
                $('#toggleView i').attr('class', 'fas fa-chevron-up');
            }
        } else {
            $('#scroll_top_btn').css('opacity', '0.5');
            if (isDesktop) {
                $('#toggleView').removeClass('visible').hide();
            }
        }
    }
});

$('#scroll_top_btn').on('click', function() {
    $('#list-container').animate({ scrollTop: 0 }, 400);
});

// Function to handle showing the detail page with context-aware positioning
// source: 'map' (clicked from map marker) or 'list' (clicked from list card) or 'auto' (detect)
window.showSVRDetailPage = function(objectId, source = 'auto') {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: true }, '*');
    }
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const isDesktop = window.innerWidth >= 768;

    // Sluit een geopende filter-overlay zodat de detailpagina zichtbaar wordt
    const filterOverlayEl = document.getElementById('svr-filter-overlay');
    const filterBackdropEl = document.getElementById('svr-filter-backdrop');
    const filtersWereOpen = !!(filterOverlayEl && filterOverlayEl.classList.contains('open'));
    if (filtersWereOpen) {
        filterOverlayEl.classList.remove('open');
        filterOverlayEl.style.display = 'none';
        filterOverlayEl.style.transform = '';
        if (filterBackdropEl) {
            filterBackdropEl.classList.remove('open');
            filterBackdropEl.style.display = 'none';
        }
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
        }
    }

    // If a detail page is already open, replace it (prevent stacking)
    const wasDetailOpen = history.state && history.state.view === 'detail';
    
    if (wasDetailOpen) {
        // Clear existing content without animation
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => {
            if (el.id !== 'detail-splash') el.remove();
        });
        // Replace the current history state instead of pushing a new one
        history.replaceState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
    }

    // Determine source context
    if (source === 'auto') {
        if (isDesktop) {
            // On desktop, detect based on current mode
            if (document.body.classList.contains('list-only-mode')) {
                source = 'list';
            } else if (document.body.classList.contains('map-only-mode')) {
                source = 'map';
            } else {
                // Split mode - default to opening in map panel (right side)
                source = 'map'; // Clicked from map, open in list panel area
            }
        } else {
            source = isListView ? 'list' : 'map';
        }
    }

    // Desktop: Open as panel, Mobile: Open as fullscreen overlay
    if (isDesktop) {
        // Verwijder eventuele oude context-klassen (niet meer nodig maar veilig)
        detailOverlay.classList.remove('detail-from-map', 'detail-from-list');

        // Splash verbergen op desktop (CSS doet dit al, maar voor zekerheid)
        if (splashScreen) splashScreen.style.display = 'none';

        // Verwijder bestaande inhoud (behalve splash)
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => {
            if (el.id !== 'detail-splash') el.remove();
        });

        // Open het rechter paneel
        openRightPanel('detail');

        // Synchroniseer kaart op desktop als we vanuit de lijst komen
        if (source === 'list' && window.staticCampsites) {
            const camping = window.staticCampsites.find(c => c.id === objectId);
            if (camping && window.focusOnMarker) {
                const cLat = camping.geometry && camping.geometry.coordinates ? camping.geometry.coordinates[1] : (camping.lat !== undefined ? camping.lat : null);
                const cLng = camping.geometry && camping.geometry.coordinates ? camping.geometry.coordinates[0] : (camping.lng !== undefined ? camping.lng : null);
                if (cLat !== null && cLng !== null) {
                    // Focus op marker met HUIDIGE zoomniveau
                    window.focusOnMarker(cLat, cLng, objectId, map.getZoom());
                }
            }
        }

        // Push state voor backknop-ondersteuning (only if not replacing)
        if (wasDetailOpen || filtersWereOpen) {
            history.replaceState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
        } else {
            history.pushState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
        }
        renderDetail(objectId);
        return; // Vroeg terugkeren, rest van de functie is mobile-only
    }

    // CRITICAL FIX: Explicitly remove transform property and force reflow
    detailSheet.style.removeProperty('transform');
    detailSheet.style.transition = 'none';
    void detailSheet.offsetWidth;
    detailSheet.style.transition = '';

    // Clear actual content area
    if (!isDesktop) {
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
    } else {
        // On desktop, clear everything except splash (which is hidden)
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => el.remove());
    }

    // Show backdrop (mobile only)
    if (backdrop && !isDesktop) {
        backdrop.style.display = 'block';
        setTimeout(() => backdrop.classList.add('open'), 10);
    }

    detailOverlay.style.display = 'block';

    if (!isDesktop) {
        setTimeout(() => {
            detailOverlay.classList.add('open');
        }, 10);
    }

    // Push state and fetch content
    if (wasDetailOpen || filtersWereOpen) {
        history.replaceState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
    } else {
        history.pushState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
    }
    renderDetail(objectId);
};

// Function to handle the back action for the detail sheet
window.handleDetailBack = function() {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
    }
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');
    const isDesktop = window.innerWidth >= 768;

    // Remove desktop panel context classes
    detailOverlay.classList.remove('detail-from-map', 'detail-from-list');

    if (isDesktop) {
        closeRightPanel();
        detailOverlay.classList.remove('detail-from-map', 'detail-from-list');
        detailOverlay.style.display = 'none';
        if (splashScreen) splashScreen.style.display = 'none';

        if (history.state && history.state.view === 'detail') {
            history.back();
        }
        return;
    }
        // Mobile: Animate out
        detailSheet.classList.remove('open');
        detailOverlay.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        if (splashScreen) splashScreen.classList.add('hide');

        setTimeout(() => {
            detailOverlay.style.display = 'none';
            if (backdrop && !document.getElementById('svr-filter-overlay').classList.contains('open')) {
                backdrop.style.display = 'none';
            }
            if (splashScreen) {
                splashScreen.classList.remove('hide');
            }
        }, 400);

    // Navigate back in history
    if (history.state && history.state.view === 'detail') {
        history.back();
    }
};


// Update onpopstate to handle the sheet animation on history changes
window.onpopstate = (e) => {
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');
    const filterOverlay = document.getElementById('svr-filter-overlay');

    if (e.state) {
        const isDesktopPop = window.innerWidth >= 768;
        if (isDesktopPop) {
            // Op desktop: herstel body-class en sluit panelen indien nodig
            if (!e.state || (e.state.view !== 'detail' && e.state.view !== 'filters')) {
                closeRightPanel();
            }
            if (e.state && e.state.view === 'detail' && e.state.objectId) {
                // Detail heropenen via history (bijv. forward-navigatie)
                openRightPanel('detail');
                renderDetail(e.state.objectId);
            }
            if (!e.state || e.state.view === 'map' || e.state.view === 'list' || e.state.view === 'split') {
                // Standaard desktop: niets te doen, kaart en lijst zijn altijd zichtbaar
                if (map) setTimeout(() => map.invalidateSize(), 100);
            }
            return; // Desktop afgehandeld, mobile-logica overslaan
        }

        applyState(e.state);
        
        // Handle Filters View
        if (e.state.view === 'filters') {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: true }, '*');
            }
            // This is reached if we navigate FORWARD to filters (rare but possible via history)
            backdrop.style.display = 'block';
            setTimeout(() => { 
                filterOverlay.classList.add('open'); 
                backdrop.classList.add('open'); 
            }, 10);
        } else {
            // For any other view, if the filters were open, hide them
            if (filterOverlay && filterOverlay.classList.contains('open')) {
                window.hideFilterOverlay();
            }
        }

        // Handle Detail View
        if (e.state.view === 'detail' && e.state.objectId) {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: true }, '*');
            }
            // Show splash and start typewriter effect
            if (splashScreen) {
                splashScreen.classList.remove('hide');
                typewriterEffect('detail-splash-text', 'Kamperen bij de boer');
                 // Clear actual content area, but don't remove splash
                const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
                elementsToClear.forEach(el => el.remove());
            }

            if (backdrop) {
                backdrop.style.display = 'block';
                setTimeout(() => backdrop.classList.add('open'), 10);
            }
            detailOverlay.style.display = 'block';
            setTimeout(() => {
                detailOverlay.classList.add('open');
                detailSheet.classList.add('open'); // This will trigger the slide up animation
                renderDetail(e.state.objectId); // This will fetch content and hide splash
            }, 10);
        } else if (e.state.view === 'list' || e.state.view === 'map') {
            if (detailOverlay.classList.contains('open') && window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
            }
            detailSheet.classList.remove('open');
            detailOverlay.classList.remove('open');
            if (backdrop && !filterOverlay.classList.contains('open')) backdrop.classList.remove('open');
            if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on state change

            setTimeout(() => {
                detailOverlay.style.display = 'none';
                if (backdrop && !filterOverlay.classList.contains('open')) backdrop.style.display = 'none';
            }, 400);
        }
    } else {
        // Fallback if state is null (e.g., initial page load or unmanaged history entry)
        applyState({ view: 'map' }); // Default to map view
        
        if (filterOverlay && filterOverlay.classList.contains('open')) {
            window.hideFilterOverlay();
        }

        if (detailOverlay.classList.contains('open') && window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }

        detailSheet.classList.remove('open');
        detailOverlay.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on fallback

        setTimeout(() => {
            detailOverlay.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
        }, 400);
    }
};

// Toggle knop:
// - Desktop: scroll-to-top voor lijst (wordt zichtbaar bij scrollen)
// - Mobile: wissel tussen kaart en lijst
$('#toggleView').on('click', () => {
    const isDesktop = window.innerWidth >= 768;

    if (isDesktop) {
        // Desktop: scroll naar boven
        $('#list-container').animate({ scrollTop: 0 }, 400);
    } else {
        // Mobile: toggle tussen kaart en lijst
        isListView = !isListView;
        applyState({ view: isListView ? 'list' : 'map' });
        history.pushState({ view: isListView ? 'list' : 'map' }, "");
    }
});

// Helper function to set desktop view mode
function setDesktopViewMode(mode) {
    // Op desktop is er maar één layout: kaart links, lijst/paneel rechts.
    // De body-class split-mode/map-only/list-only is niet meer nodig.
    // We houden 'split-mode' als standaard body-class voor backward compatibility.
    document.body.classList.remove('split-mode', 'map-only-mode', 'list-only-mode');
    document.body.classList.add('split-mode');
    isListView = false;

    // Sluit eventuele open panelen
    closeRightPanel();

    // Zorg dat de kaart de juiste grootte heeft
    setTimeout(() => {
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }
    }, 100);
}

/**
 * Opent een paneel rechts op desktop (detail of filter).
 * Sluit eerst het andere paneel als dat open is.
 * @param {'detail'|'filter'} type
 */
function openRightPanel(type) {
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop) return; // Mobile heeft eigen logica

    const detailEl = document.getElementById('detail-container');
    const filterEl = document.getElementById('svr-filter-overlay');

    // Sluit beide eerst (schone lei)
    if (window.parent !== window) {
        if (detailEl.classList.contains('open') && type !== 'detail') {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        if (filterEl.classList.contains('open') && type !== 'filter') {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
        }
    }

    detailEl.style.display = 'none';
    detailEl.classList.remove('open');
    filterEl.style.display = 'none';
    filterEl.classList.remove('open');

    // Toon de gevraagde met FLEX (belangrijk voor header fix)
    if (type === 'detail') {
        detailEl.style.display = 'flex';
        detailEl.classList.add('open');
    } else if (type === 'filter') {
        filterEl.style.display = 'flex';
        filterEl.classList.add('open');
    }

    document.body.classList.add('panel-open');
    // Desktop: verberg toggle knop als paneel open is
    if (isDesktop) {
        $('#toggleView').hide();
    } else {
        // Mobile: toon sluit-icoon
        $('#toggleView i').attr('class', 'fas fa-xmark');
    }
}

/**
 * Sluit het actieve rechter paneel en toont de lijst weer.
 */
function closeRightPanel() {
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop) return;

    const detailEl = document.getElementById('detail-container');
    const filterEl = document.getElementById('svr-filter-overlay');

    if (window.parent !== window) {
        if (detailEl.classList.contains('open')) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        if (filterEl.classList.contains('open')) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
        }
    }

    detailEl.style.display = 'none';
    detailEl.classList.remove('open');
    filterEl.style.display = 'none';
    filterEl.classList.remove('open');

    document.body.classList.remove('panel-open');
    // Desktop: verberg toggle knop (wordt getoond bij scrollen)
    $('#toggleView').hide().removeClass('visible');
}

// Expose voor gebruik in event handlers
window.closeRightPanel = closeRightPanel;

// Initialiseer desktop layout
if (window.innerWidth >= 768) {
    document.body.classList.add('split-mode');
    // Forceer schone lei voor panelen
    closeRightPanel();
    // Zorg dat kaart correct geladen wordt
    setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    // Toon locate button op desktop
    $('#locateBtn').show();
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }

        const isDesktop = window.innerWidth >= 768;
        if (isDesktop && !document.body.classList.contains('split-mode')) {
            document.body.classList.add('split-mode');
            document.body.classList.remove('map-only-mode', 'list-only-mode');
        }
    }, 100);
});
const $searchInput = $('#searchInput'); const $suggestionsList = $('#suggestionsList');

// Clear search input on click if it has a value
$searchInput.on('click', function() {
    if ($(this).val().length > 0) {
        $(this).val('');
        $suggestionsList.hide();
    }
});

// Trigger search on Enter key
$searchInput.on('keydown', function(e) {
    if (e.key === 'Enter') {
        $suggestionsList.hide();
        window.performSearch();
    }
});

// Trigger search on Icon click
$('#searchIcon').on('click', function() {
    $suggestionsList.hide();
    window.performSearch();
});

$searchInput.on('input', function() {
    const q = $(this).val(); if (q.length < 2) { $suggestionsList.hide(); return; }
    const suggestions = window.getSuggestionsLocal(q);
    $suggestionsList.empty();
    if (suggestions.length === 0) { $suggestionsList.hide(); return; }
    suggestions.forEach(p => {
        const $li = $('<li class="suggestion-item"></li>').text(p);
        $li.on('click', (e) => { e.stopPropagation(); $searchInput.val(p); $suggestionsList.hide(); window.performSearch(); });
        $suggestionsList.append($li);
    });
    $suggestionsList.show();
});

window.performSearch = async function(forceAPI = false) {
    if (isSearching) return;
    isSearching = true;

    // Hide keyboard
    $searchInput.blur();

    const q = $searchInput.val().trim();
    let sLat = 52.1326, sLng = 5.2913;

    if (q) {
        // Geocoding om coördinaten van de plaatsnaam te krijgen
        const coords = await window.getCoordinatesWeb(q);
        if (coords) {
            sLat = coords.latitude; sLng = coords.longitude;
        } else {
            // Feedback voor niet gevonden locatie (of geen internet: geocoding vereist een verbinding)
            const originalPlaceholder = $searchInput.attr('placeholder');
            const notFoundMsg = !navigator.onLine ? 'Geen internetverbinding...' : 'Plaats niet gevonden...';
            $searchInput.val('').attr('placeholder', notFoundMsg).addClass('search-error');
            setTimeout(() => {
                $searchInput.attr('placeholder', originalPlaceholder).removeClass('search-error');
            }, 3000);
            isSearching = false;
            return;
        }
    } else if (currentUserLatLng) {
        sLat = currentUserLatLng.lat; sLng = currentUserLatLng.lng;
    }

    // Update de rode punaise naar de nieuwe locatie
    if (centerMarker) map.removeLayer(centerMarker);
    centerMarker = L.marker([sLat, sLng], {
        icon: L.divIcon({
            className: 'search-marker',
            html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>',
            iconSize:[30,30],
            iconAnchor:[15,30]
        }),
        zIndexOffset: 2000
    }).addTo(map);

    // UNIFIED SEARCH & FILTER LOGIC (API Delivery)
    logDebug(`Unified Search/Filter: ${q ? "Zoeken naar " + q : "Alleen filters"}`);
    try {
        const objects = await window.fetchCampingObjects(sLat, sLng);
        objects.sort((a, b) => a.distM - b.distM);
        window.staticCampsites = objects;
        window.skipFitBounds = false;
        renderResults(objects, sLat, sLng);
        window.hasDataOnScreen = true;
    } catch (e) {
        logDebug("Zoekfout: " + e.message);
    } finally {
        isSearching = false;
        setTimeout(() => map.invalidateSize(), 500);
    }
}

// renderDetail — reconstructs the ORIGINAL PWA detail page look from API JSON.
// Structure/styles mirror the svr.nl object page that the original PWA embedded:
// sticky yellow close-header, swiper photo carrousel, yellow section bars,
// object_pricing table, restorelines facilities, contact/footer blocks.
async function renderDetail(objectId) {
    const detailSheet = document.querySelector('#detail-container .detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');

    // Zorg dat de splash zichtbaar blijft tot de inhoud klaar is
    if (splashScreen) {
        splashScreen.classList.remove('hide');
    }

    try {
        const apiBase = window.API_BASE || 'https://svr-backend.e60-manuels.workers.dev';
        const detailUrl = `${apiBase}/api/objects/${objectId}`;
        logDebug(`Detail laden via API: ${detailUrl}`);
        let data = window._detailCache[objectId];
        if (!data) {
            const res = await fetch(detailUrl);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            data = await res.json();
            window._detailCache[objectId] = data;
        } else {
            logDebug("Detail uit cache geladen.");
        }
        const obj = data.object || {};
        const p = obj.properties || {};
        const coords = (obj.geometry && obj.geometry.coordinates) || [];
        const lat = coords.length > 1 ? coords[1] : null;
        const lng = coords.length > 1 ? coords[0] : null;

        const name = p.name || 'Onbekende camping';
        const city = p.city || '';
        const adres = p.adres || '';
        const zipcode = p.zipcode || '';
        const country = p.country_full || '';
        const description = String(p.description || p.short_description || '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/\r?\n/g, '<br>');
        const images = (Array.isArray(p.images) ? p.images : []).filter(u => typeof u === 'string' && u).map(u => /^https?:\/\//.test(u) ? u : apiBase + u);
        const facList = (Array.isArray(p.facilities) ? p.facilities : []).filter(s => typeof s === 'string' && s);
        const tariffs = (p.tarieven && typeof p.tarieven === 'object') ? p.tarieven : {};
        const canReserve = (String(p.reservering) === '1' || p.reservering === true || parseInt(p.reservering) > 0);
        const phone = p.tel || '';
        const email = p.email || '';
        const url = p.url || '';
        const zipCity = [zipcode, city].filter(s => String(s).trim()).map(s => String(s).toUpperCase()).join(', ');

        function escapeHtml(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Maak de omschrijving schoon: de API-beschrijving bevat vaak vooraan
        // een herhaalde campingnaam + 'Favoriet'-knop (uit een scraped pagina).
        // Daarnaast worden lange <br>-reeksen teruggebracht, zodat alinea's op
        // <br><br> en lijstregels op een enkele <br> uitkomen zoals op svr.nl.
        function cleanDetailDescription(raw) {
            const nameCmp = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
            let s = String(raw || '').replace(/<br\s*\/?>/gi, '<br>');
            let blocks = s.split('<br>').map(b => b.replace(/&nbsp;/gi, ' ').trim()).filter(Boolean);
            const favIdx = blocks.findIndex(b => b.toLowerCase().replace(/\s+/g, ' ') === 'favoriet');
            if (favIdx > 0) {
                let end = favIdx;
                for (let i = favIdx + 1; i < blocks.length; i++) {
                    if (blocks[i].toLowerCase().replace(/\s+/g, ' ') === nameCmp || blocks[i].toLowerCase().replace(/\s+/g, ' ') === 'favoriet') {
                        end = i;
                    } else {
                        break;
                    }
                }
                blocks = blocks.slice(end + 1);
            }
            let out = blocks[0] || '';
            for (let i = 1; i < blocks.length; i++) {
                const b = blocks[i];
                out += (b.charAt(0) === '-' ? '<br>' : '<br><br>') + b;
            }
            return out;
        }

        function toDMS(coord, isLat) {
            const abs = Math.abs(coord);
            const d = Math.floor(abs);
            const mFloat = (abs - d) * 60;
            const m = Math.floor(mFloat);
            const s = Math.round((mFloat - m) * 60);
            const dir = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
            return `${d}° ${m}' ${s}" ${dir}`;
        }

        // SVR-richttarief munt(en): het euro-cirkel icoon zoals op svr.nl
        const COIN_SVG = (n) => {
            let html = '';
            for (let i = 0; i < n; i++) {
                html += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 24px; display: inline; fill: #FDCC01; margin-top: -4px;"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.902 7.098a3.75 3.75 0 0 1 3.903-.884.75.75 0 1 0 .498-1.415A5.25 5.25 0 0 0 8.005 9.75H7.5a.75.75 0 0 0 0 1.5h.054a5.281 5.281 0 0 0 0 1.5H7.5a.75.75 0 0 0 0 1.5h.505a5.25 5.25 0 0 0 6.494 2.701.75.75 0 1 0-.498-1.415 3.75 3.75 0 0 1-4.252-1.286h3.001a.75.75 0 0 0 0-1.5H9.075a3.77 3.77 0 0 1 0-1.5h3.675a.75.75 0 0 0 0-1.5h-3c.105-.14.221-.274.348-.402Z" clip-rule="evenodd"></path></svg>`;
            }
            return html;
        };

        const catCoins = (v) => COIN_SVG(Math.max(0, parseInt(v) || 0));

        // Tarieven: hoofdprijzen (Laagseizoen/Hoogseizoen) vs "Overige Tarieven" tabel
        const mainTariffKeys = ['Laagseizoen', 'Hoogseizoen', 'Gehele Seizoen'];
        const tariffValues = [];
        const otherTariffs = [];
        let tariffHeader = 'Normaal';
        Object.entries(tariffs).forEach(([k, v]) => {
            if (mainTariffKeys.includes(k)) {
                tariffValues.push({ key: k, val: String(v == null ? '' : v) });
            } else if (String(k).toLowerCase() === 'overige tarieven') {
                tariffHeader = String(v == null ? 'Normaal' : v);
            } else {
                otherTariffs.push({ key: k, val: String(v == null ? '' : v) });
            }
        });
        const formatPrice = (v) => {
            v = String(v || '').trim();
            if (!v) return '';
            if (v.indexOf('€') !== -1 || v.indexOf('EUR') !== -1) return v;
            return /^[\d.,]+$/.test(v) ? '€ ' + v : v;
        };
        const overigeCell = (v) => {
            v = String(v || '').trim();
            if (!v) return `<img src="https://svr.nl/px/ok.jpg" alt="" height="16" width="16">`;
            return escapeHtml(formatPrice(v));
        };

        // Container-CSS staat nu statisch in css/local_style.css (was inline)

        // Sticky gele close-header, exact zoals in de originele PWA
        const closeBtn = `<div class="detail-header" style="position: sticky; top: 0; background: #FDCC01; padding: 10px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; z-index: 10001; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: grab;">
            <div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px; margin-bottom: 8px;"></div>
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 5px;">
                <button onclick="window.handleDetailBack()" style="background: none; border: none; font-size: 20px; cursor: pointer; padding: 5px; color: #333;"><i class="fas fa-arrow-left"></i></button>
                <h3 style="margin: 0; font-family: 'Befalow'; color: #333; font-size: 1.2rem;">Camping Details</h3>
                <div style="width: 30px;"></div>
            </div>
        </div>`;

        // Reserveringsformulier exact zoals op de svr.nl objectpagina; verzending via e-mail
        const reserveForm = canReserve ? `
        <div class="card p-2 border-radius" id="aanvraag">
            <p class="p-0 pt-0 m-0 pb-0 text-center">
                <span class="text-center mx-auto befalow" style="font-size: 33px; text-transform: capitalize; padding: 2rem; line-height: 5rem; font-family: Befalow, sans-serif !important;">
                    Reserveringsaanvraag
                </span>
            </p>
            <p>
                U kunt bij deze camping direct een reserveringsaanvraag doen. De camping neemt dan zo spoedig mogelijk contact met u op.
                <br><br>
                <strong>Let op:</strong><br>
                Dit is geen definitieve reservering.
            </p>
            <div class="row">
                <div class="col-sm-6 text-center">
                    <h3 class="befalow" style="font-family: Befalow, sans-serif !important; font-size: 20px;">Aankomstdatum</h3>
                    <input type="date" oninput="window.validateReserveringForm()" id="start_date" placeholder="dd/mm/yyyy" value="" class="form-control">
                </div>
                <div class="col-sm-6 text-center">
                    <h3 class="befalow" style="font-family: Befalow, sans-serif !important; font-size: 20px;">Vertrekdatum</h3>
                    <input type="date" oninput="window.validateReserveringForm()" id="end_date" placeholder="dd/mm/yyyy" class="form-control">
                </div>
            </div>

            <div class="row">
                <div class="col-sm-6">
                    <small>Contact Naam:</small> <br>
                    <div class="input-group">
                        <input type="text" oninput="window.validateReserveringForm()" id="contact_name" class="form-control">
                    </div>
                </div>
                <div class="col-sm-6">
                    <small>Contact mailadres:</small> <br>
                    <div class="input-group">
                        <input type="text" style="text-transform: lowercase;" oninput="window.validateReserveringForm()" id="contact_email" class="form-control">
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-sm-6">
                    <small>Aantal personen:</small> <br>
                    <div class="input-group">
                        <input type="number" min="1" oninput="window.validateReserveringForm()" id="persons" class="form-control" value="1">
                    </div>
                </div>
                <div class="col-sm-6">
                    <small>Contact telefoonnummer:</small> <br>
                    <div class="input-group">
                        <input type="text" id="contact_phone" oninput="window.validateReserveringForm()" class="form-control">
                    </div>
                </div>
            </div>

            <small> Met welk kampeermiddel komt u?</small>
            <select class="form-select" id="kampeermiddel">
                <option>Caravan</option>
                <option>Camper</option>
                <option>Tent</option>
                <option>Vouwwagen</option>
                <option>Anders</option>
            </select>

            <small> Neemt u een huisdier mee?</small>
            <select class="form-select" id="huisdier">
                <option>Nee</option>
                <option>Ja, 1 hond</option>
                <option>Ja, 2 honden</option>
                <option>Ja, ander dier</option>
            </select>

            <small>Donateursnummer</small>
            <input type="text" class="form-control" id="donateursnummer">
            <hr>
            <small class="mt-4">Opmerkingen:</small>
            <textarea class="form-control" id="notes" rows="4"></textarea>
            <br>
            <button disabled="" class="btn btn-svr-blue border-radius" id="send_button" onclick="window.detailReserveringSubmit('${escapeHtml(email)}', '${escapeHtml(name)}')">
                Reservering aanvragen
            </button>
        </div>` : '';

        // --- svr.nl objectpagina structuur, gereconstrueerd uit de API-data ---
        const bodyParts = [];

        bodyParts.push(`<div class="container-fluid pt-0">`);
        bodyParts.push(`<div class="row">`);
        bodyParts.push(`<div class="col-sm-8 p-4 pt-2">`);

        bodyParts.push(`<a class="btn btn-light mt-4 ms-4" href="https://www.svr.nl/objects" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-left"></i><span class="d-none d-lg-inline-block"> Terug naar overzicht </span></a>`);
        bodyParts.push(`<br><br>`);

        // Titel + omschrijving
        bodyParts.push(`<div class="card p-3 fw-light" style="display: block; border-radius: 0 15px 15px 0; border: 1px solid rgba(0,0,0,.1); font-size: 12pt; background-color: white; color: #2e2e2e;">`);
        bodyParts.push(`<div>`);
        bodyParts.push(`<div class="veeg-yellow d-inline-block float-left text-center veeg-campings" style="text-transform: capitalize; background-size: 100% 100%;"><h1 class="befalow float-center" style="font-family: Befalow, sans-serif !important;">${escapeHtml(name)}</h1></div>`);
        bodyParts.push(`<h1 class="float-right d-inline-block"><button class="btn btn-light shadow-none ml-auto" style="color: #d11a2a;"><i class="fa-solid fa-heart" aria-hidden="true"></i> Favoriet</button></h1>`);
        bodyParts.push(`</div>`);
        bodyParts.push(`<hr style="color: rgba(0,0,0,.2)">`);
        if (description && String(description).trim()) {
            bodyParts.push(cleanDetailDescription(String(description).trim()));
        }
        bodyParts.push(`</div>`);

        // Faciliteiten (gele balk + restorelines in 2 kolommen, zoals svr.nl dit aanlevert)
        if (facList.length > 0) {
            bodyParts.push(`<div class="p-3">`);
            bodyParts.push(`<div class="row">`);
            bodyParts.push(`<div class="col-sm-12">`);
            bodyParts.push(`<div class="p-2" style="background-color:#FDCC01;"><h5>Faciliteiten:</h5></div>`);
            bodyParts.push(`<div class="row w-100">`);
            const mid = Math.ceil(facList.length / 2);
            [facList.slice(0, mid), facList.slice(mid)].forEach(col => {
                if (col.length === 0) return;
                bodyParts.push(`<div class="restorelines col-sm-6">` + col.map(f => `- ${f} <br>`).join(`\n`) + `</div>`);
            });
            bodyParts.push(`</div>`);
            bodyParts.push(`</div>`);
            bodyParts.push(`</div>`);
            bodyParts.push(`</div>`);
        }

        // Foto-carrousel (swiper, 240px hoog zoals de originele PWA)
        if (images.length > 0) {
            bodyParts.push(`<div class="swiper svr-detail-swiper" style="width: 100%; height: 240px; background: rgb(248, 248, 248); position: relative; touch-action: pan-y; overflow: hidden; margin-bottom: 20px;">`);
            bodyParts.push(`<div class="swiper-wrapper">` + images.map((img, idx) => `
                <div class="swiper-slide" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;"><img src="${escapeHtml(img)}" loading="lazy" style="max-width: 100%; max-height: 100%; object-fit: contain;"></div>`).join('') + `</div>`);
            bodyParts.push(`<div class="swiper-pagination"></div>`);
            bodyParts.push(`<div class="swiper-button-prev"></div>`);
            bodyParts.push(`<div class="swiper-button-next"></div>`);
            bodyParts.push(`</div>`);
        }

        bodyParts.push(`<div class="row"></div>`);

        // Tarieven
        if (tariffValues.length > 0 || otherTariffs.length > 0) {
            bodyParts.push(`<div class="p-2 object_pricing" style="font-size: 19px;">`);
            if (tariffValues.length > 0) {
                bodyParts.push(`<br><strong>Tarief</strong><br>`);
                tariffValues.forEach(t => {
                    bodyParts.push(`- ${escapeHtml(t.key)}: ${formatPrice(t.val) ? escapeHtml(formatPrice(t.val)) : '&nbsp;'}<br>`);
                });
                bodyParts.push(`<br>`);
            }
            if (otherTariffs.length > 0) {
                bodyParts.push(`<table><tbody><tr><td style="width:380px"><p style="margin:0;font-weight:bold;"><strong>Overige Tarieven</strong></p></td><td style="width:50px; text-align: right; margin-right: 1em;">${escapeHtml(tariffHeader)}</td></tr>`);
                otherTariffs.forEach(t => {
                    bodyParts.push(`<tr><td style="width:380px">- ${escapeHtml(t.key)}</td><td style="width:50px; text-align: right; margin-right: 1em;">${overigeCell(t.val)}</td><td style="width:50px; text-align: right; margin-right: 1em;"></td></tr>`);
                });
                bodyParts.push(`</tbody></table>`);
            }
            bodyParts.push(`</div>`);
        }

        // SVR-richttarief categorie
        const catLaag = parseInt(p.tar_cat_laag) || 0;
        const catHoog = parseInt(p.tar_cat_hoog) || 0;
        if (catLaag > 0 || catHoog > 0) {
            const infoText = `<strong>Richttarief p.n. (2 pers.)</strong><br>NL: L €21,90 / H €22,90<br>Buitenland: L €28 / H €30 <br>Incl. kampeermiddel, 4 kWh elektra douche & wifi. <br>Excl. toeristenbelasting & huisdier`;
            bodyParts.push(`<div class="p-2 mt-4">`);
            bodyParts.push(`<strong>SVR-richttarief categorie <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="display: inline; width: 24px; margin-top: -4px; height: 24px;" data-bs-toggle="tooltip" data-bs-custom-class="popover-left" data-bs-html="true" title="${escapeHtml(infoText).replace(/"/g, '&quot;')}"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm11.378-3.917c-.89-.777-2.366-.777-3.255 0a.75.75 0 0 1-.988-1.129c1.454-1.272 3.776-1.272 5.23 0 1.513 1.324 1.513 3.518 0 4.842a3.75 3.75 0 0 1-.837.552c-.676.328-1.028.774-1.028 1.152v.75a.75.75 0 0 1-1.5 0v-.75c0-1.279 1.06-2.107 1.875-2.502.182-.088.351-.199.503-.331.83-.727.83-1.857 0-2.584ZM12 18a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd"></path></svg>:</strong><br>`);
            if (catLaag > 0) bodyParts.push(`<div style="font-size: 95%;">- Laagseizoen: ${catCoins(catLaag)}</div>`);
            if (catHoog > 0) bodyParts.push(`<div style="font-size: 95%; margin-top: .2em;">- Hoogseizoen: ${catCoins(catHoog)}</div>`);
            bodyParts.push(`</div>`);
        }

        // Reserveringsaanvraag (indien de camping dit aanbiedt)
        bodyParts.push(reserveForm);

        bodyParts.push(`</div>`);

        // Rechterkolom: contact + GPS/Routebeschrijving
        bodyParts.push(`<div class="col-sm-4 pt-5">`);
        bodyParts.push(`<div class="card mt-5 text-center border-radius p-2">`);
        bodyParts.push(`<strong style="text-transform: capitalize;">${escapeHtml(name)}</strong><br>`);
        if (adres) bodyParts.push(`<span>${escapeHtml(adres)}</span>`);
        if (zipCity) bodyParts.push(`<span>${escapeHtml(zipCity)}</span>`);
        if (country) bodyParts.push(`<span>${escapeHtml(country)}</span>`);
        bodyParts.push(`<br>`);
        if (phone) bodyParts.push(`Tel: ${escapeHtml(phone)} <br>`);
        bodyParts.push(`<br>`);
        if (email) bodyParts.push(`E-mail: ${escapeHtml(email)}`);
        bodyParts.push(`<br><br>`);
        const websiteUrl = /^https?:\/\//.test(url) ? url : url ? 'https://' + url : '';
        if (websiteUrl) {
            bodyParts.push(`<a href="${escapeHtml(websiteUrl)}" target="_blank" class="btn btn-light befalow border-radius" style="background-color: rgb(0, 139, 211); color: white; font-size: 16pt; font-family: Befalow, sans-serif !important;" rel="noopener noreferrer"> Bekijk website </a>`);
        }
        bodyParts.push(`</div>`);
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
            bodyParts.push(`<div class="card text-center border-radius p-2">`);
            bodyParts.push(`<br><strong>GPS</strong>`);
            bodyParts.push(`<small>${toDMS(lat, true)} ${toDMS(lng, false)}</small>`);
            bodyParts.push(`<small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small>`);
            bodyParts.push(`<br>`);
            bodyParts.push(`<a href="https://www.google.nl/maps/search/${lat},${lng}" target="_blank" class="btn btn-light befalow border-radius" style="background-color: rgb(0, 139, 211); color: white; font-size: 16pt; font-family: Befalow, sans-serif !important;" rel="noopener noreferrer"> Routebeschrijving </a>`);
            bodyParts.push(`</div>`);
        }
        bodyParts.push(`</div>`);
        bodyParts.push(`</div>`);

        // Blauwe svr.nl-footer
        bodyParts.push(`<div class="container-fluid footer p-5">`);
        bodyParts.push(`<div class="container">`);
        bodyParts.push(`<div class="row">`);
        bodyParts.push(`<div class="col-sm-3"><h3 class="befalow" style="font-family: Befalow, sans-serif !important;">Informatie</h3>`);
        bodyParts.push(`<a href="https://www.svr.nl/veelgestelde-vragen" class="link-dark" target="_blank" rel="noopener noreferrer">Veel gestelde vragen</a> <br>`);
        bodyParts.push(`<a href="https://www.svr.nl/privacy" class="link-dark" target="_blank" rel="noopener noreferrer">Privacy</a> <br>`);
        bodyParts.push(`<a href="https://www.svr.nl/algemene-voorwaarden" class="link-dark" target="_blank" rel="noopener noreferrer">Algemene voorwaarden</a> <br>`);
        bodyParts.push(`<a href="https://svrcamping.de/" class="link-dark" target="_blank" rel="noopener noreferrer">Duitse website</a> <br></div>`);
        bodyParts.push(`<div class="col-sm-3"><h3 class="befalow" style="font-family: Befalow, sans-serif !important;">Voor campings</h3>`);
        bodyParts.push(`<a href="https://www.svr.nl/boeren" class="link-dark" target="_blank" rel="noopener noreferrer">Ook SVR camping worden?</a> <br></div>`);
        bodyParts.push(`<div class="col-sm-3"><h3 class="befalow" style="font-family: Befalow, sans-serif !important;">Contact SVR</h3>`);
        bodyParts.push(`<a href="tel:0183352741" class="link-dark">0183 352741</a> <br><br>`);
        bodyParts.push(`<a href="mailto:info@svr.nl" class="link-dark">info@svr.nl</a></div>`);
        bodyParts.push(`<div class="col-sm-3"><h3 class="befalow" style="font-family: Befalow, sans-serif !important;">Volg ons</h3>`);
        bodyParts.push(`<a target="_blank" href="https://www.facebook.com/stichtingvrijerecreatie.svr/" style="color: black !important;" rel="noopener noreferrer"><i class="fab fa-facebook" style="font-size: 25pt" aria-hidden="true"></i></a></div>`);
        bodyParts.push(`</div>`);
        bodyParts.push(`</div>`);
        bodyParts.push(`</div>`);

        bodyParts.push(`</div>`);

        const tempDiv = document.createElement('div');
        tempDiv.className = 'injected-detail-content';
        tempDiv.insertAdjacentHTML('beforeend', bodyParts.join(''));

        // Verwijder oude content (maar behoud de splash)
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());

        if (splashScreen) splashScreen.classList.add('hide');
        detailSheet.insertAdjacentHTML('afterbegin', closeBtn);
        detailSheet.appendChild(tempDiv);

        // Swipe-om-te-sluiten, net als de originele PWA
        if (window.enableSwipeToClose) window.enableSwipeToClose(detailSheet, window.handleDetailBack, '.detail-header');

        // Swiper carrousel initialiseren (lazy geladen beelden inbegrepen)
        const swiperEl = tempDiv.querySelector('.svr-detail-swiper');
        if (swiperEl && !swiperEl.dataset.swiperInitialized && typeof Swiper !== 'undefined') {
            swiperEl.dataset.swiperInitialized = 'true';
            try {
                new Swiper(swiperEl, {
                    direction: 'horizontal',
                    loop: images.length > 1,
                    speed: 400,
                    roundLengths: true,
                    lazy: false,
                    preloadImages: true,
                    pagination: { el: '.swiper-pagination', clickable: true },
                    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
                    threshold: 10,
                    touchStartPreventDefault: false,
                    on: {
                        init: function () {
                            const self = this;
                            setTimeout(() => self.update(), 500);
                            setTimeout(() => self.update(), 1500);
                        }
                    }
                });
                logDebug("Detail Swiper geïnitialiseerd.");
            } catch (e) {
                logDebug("Swiper fout: " + e.message);
            }
        }

        // Bootstrap tooltips initialiseren indien beschikbaar
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            tempDiv.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
        }
    } catch (e) {
        logDebug("Detail Fout: " + e.message);
        if (splashScreen) splashScreen.classList.add('hide');
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
        const detailErrorMsg = !navigator.onLine
            ? 'Detailpagina\'s zijn alleen beschikbaar met een internetverbinding.'
            : e.message;
        detailSheet.insertAdjacentHTML('afterbegin', `<div class="detail-header" style="position: sticky; top: 0; background: #FDCC01; padding: 10px; display: flex; align-items: center; justify-content: space-between; z-index: 10001; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: grab;"><button onclick="window.handleDetailBack()" style="background: none; border: none; font-size: 20px; cursor: pointer; padding: 5px; color: #333;"><i class="fas fa-arrow-left"></i></button><h3 style="margin: 0; font-family: 'Befalow'; color: #333; font-size: 1.2rem;">Camping Details</h3><div style="width: 30px;"></div></div>`);
        detailSheet.insertAdjacentHTML('beforeend', `<div style="padding:40px;text-align:center;"><h3>${!navigator.onLine ? 'Geen internetverbinding' : 'Fout'}</h3><p>${detailErrorMsg}</p><button onclick="window.handleDetailBack()">Terug</button></div>`);
    }
}

// Validatie + mailto-afhandeling van het reserveringsformulier in de detailpagina
window.validateReserveringForm = function() {
    const btn = document.getElementById('send_button');
    if (!btn) return;
    const val = (id) => (document.getElementById(id) || {}).value;
    const required = ['start_date', 'end_date', 'contact_name', 'contact_email', 'persons'];
    const ok = required.every(id => String(val(id) || '').trim() !== '');
    btn.disabled = !ok;
};

window.detailReserveringSubmit = function(email, campingName) {
    const val = (id) => (document.getElementById(id) || {}).value || '';
    const subject = 'Reserveringsaanvraag ' + (campingName || '');
    const body = [
        'Aankomstdatum: ' + val('start_date'),
        'Vertrekdatum: ' + val('end_date'),
        'Contact Naam: ' + val('contact_name'),
        'Contact mailadres: ' + val('contact_email'),
        'Aantal personen: ' + val('persons'),
        'Contact telefoonnummer: ' + val('contact_phone'),
        'Kampeermiddel: ' + val('kampeermiddel'),
        'Huisdier: ' + val('huisdier'),
        'Donateursnummer: ' + val('donateursnummer'),
        'Opmerkingen: ' + val('notes')
    ].join('\n');
    window.open('mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_self');
};
window.focusOnMarker = function(lat, lng, objectId, targetZoom = 16) {
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop) {
        applyState({ view: 'map' });
    }
    // Op desktop: kaart is altijd zichtbaar, geen state-switch nodig
    const targetLatLng = L.latLng(lat, lng);
    window.skipFitBounds = true;

    // Find the marker by ID - check both layers
    let foundMarker = null;
    let markerLayer = null; // Track which layer the marker belongs to

    markerCluster.eachLayer(m => {
        if (m.objId === objectId) {
            foundMarker = m;
            markerLayer = 'cluster';
        }
    });
    if (!foundMarker) {
        top10Layer.eachLayer(m => {
            if (m.objId === objectId) {
                foundMarker = m;
                markerLayer = 'top10';
            }
        });
    }

    const openPopupAfterAnimation = () => {
        // Wait for map animation to complete before opening popup
        setTimeout(() => {
            if (foundMarker) {
                foundMarker.openPopup();
            }
        }, 300);
    };

    if (foundMarker) {
        if (markerLayer === 'cluster') {
            // Marker is in cluster - zoomToShowLayer handles everything
            // It will zoom/pan to show the marker and expand clusters if needed
            markerCluster.zoomToShowLayer(foundMarker, () => {
                // Callback after cluster animation completes - just open popup
                openPopupAfterAnimation();
            });
        } else {
            // Marker is in top10Layer (already visible, not clustered)
            // Pan to location with specified zoom, then open popup
            map.setView(targetLatLng, targetZoom, { animate: true });
            openPopupAfterAnimation();
        }
    } else {
        // Marker not found - just pan to coordinates
        map.setView(targetLatLng, targetZoom);
    }

    // Lock fitBounds for a bit longer to ensure stability
    setTimeout(() => { window.skipFitBounds = false; }, 4000);
};

function renderResults(objects, cLat, cLng) {
    markerCluster.clearLayers(); top10Layer.clearLayers(); $('#resultsList').empty();
    if (objects.length === 0) { $('#resultsList').append('<div style="padding:20px;text-align:center;">Geen campings gevonden.</div>'); return; }
    const bounds = L.latLngBounds([cLat, cLng]);
    objects.forEach((obj, index) => {
        const p = obj.properties, g = obj.geometry; if (!g) return;

        // Check the type_camping field - we should only include campsites where
        // type_camping is 0, 1, or 2
        // type_camping = 3 indicates the campsite does not apply to the current filters
        const typeCamping = p.type_camping !== undefined ? p.type_camping : -1; // Default to -1 if not found

        if (typeCamping === 3) {
            // Skip this campsite as it doesn't match the current filters
            return;
        }

        const lat = g.coordinates[1], lng = g.coordinates[0], safeName = btoa(unescape(encodeURIComponent(p.name)));
        const marker = L.marker([lat, lng]);
        marker.objId = obj.id; // Store ID for reliable lookup
        
        // Match original Android app popup styling exactly
        // See: bestanden/outerHTML_marker_popup.txt
        const address = p.address ? `${p.address}, ${p.city}` : p.city;
        const distDisplay = (obj.distM/1000).toFixed(1);

        const popup = `<div style="min-width: 220px;">
            <div style="word-wrap: break-word; margin-top: -5px;">
                <h5 onclick="window.showSVRDetailPage('${obj.id}', 'map')" style="margin: 0; padding: 0; font-family: 'Befalow', sans-serif; font-size: 25px; font-weight: normal; color: #008AD3; cursor: pointer;">${p.name}</h5>
                <div style="font-size: 13px; color: #666; margin-top: 0px;">${address}</div>
                <div style="font-size: 13px; color: #333; margin-top: 2px;"><i class="fa-solid fa-map-pin" style="color: #c0392b;"></i> Afstand: ${distDisplay} km</div>
                <div class="camping-actions" style="display: flex; margin: 8px -15px -15px -15px; border-top: 1px solid #eee;">
                    <a href="#" class="action-btn btn-route" style="flex: 1; text-align: center; padding: 6px 0; color: #c0392b; text-decoration: none; font-weight: bold; font-size: 14px; border-right: 1px solid #eee;" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                    <a href="#" class="action-btn btn-info" style="flex: 1; text-align: center; padding: 6px 0; color: #008AD3; text-decoration: none; font-weight: bold; font-size: 14px;" onclick="window.showSVRDetailPage('${obj.id}', 'map'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
                </div>
            </div>
        </div>`;

        marker.bindPopup(popup);
        if (index < 10) { top10Layer.addLayer(marker); bounds.extend([lat, lng]); } else markerCluster.addLayer(marker);

        const card = `<div class="camping-card">
            <div class="card-body">
                <h3 class="camping-name-link" onclick="window.showSVRDetailPage('${obj.id}', 'list'); return false;">${p.name}</h3>
                <div class="card-location"><i class="fa-solid fa-map-pin"></i> ${p.city}</div>
                <div class="card-distance"><i class="fa-solid fa-map-pin"></i> Afstand: ${(obj.distM/1000).toFixed(1)} km</div>
            </div>
            <div class="camping-actions">
                <a href="#" class="action-btn btn-kaart" onclick="window.focusOnMarker(${lat},${lng}, '${obj.id}', map.getZoom()); return false;"><i class="fa-solid fa-map"></i> KAART</a>
                <a href="#" class="action-btn btn-route" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                <a href="#" class="action-btn btn-info" onclick="window.showSVRDetailPage('${obj.id}', 'list'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
            </div>
        </div>`;
        $('#resultsList').append(card);
    });
    
    // Store bounds for later use
    window.lastMapBounds = bounds;
    
    // Only fit bounds if map is currently visible and we're not focusing on a marker
    if (!isListView && !window.skipFitBounds) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// === MAP MENU (svr.nl link + Uitloggen) ===
window.toggleMapMenu = function() {
    const existingMenu = document.getElementById('map-actions-menu');
    if (existingMenu) {
        existingMenu.remove();
        if (window._closeMapMenuOnOutsideClick) {
            document.removeEventListener('click', window._closeMapMenuOnOutsideClick);
        }
        return;
    }

    const btn = document.getElementById('menuBtn');
    const rect = btn.getBoundingClientRect();

    // Position: fixed t.o.v. de viewport en direct aan <body> gehangen (niet
    // aan #menu-btn-wrapper) zodat dit menu altijd bovenop alles verschijnt,
    // ongeacht eventuele position/overflow/stacking-context verschillen tussen
    // de mobiele en desktop CSS-layout van .map-actions-stack. Dit is hetzelfde
    // betrouwbare patroon (position: fixed, hoge z-index) als het login-overlay,
    // dat al bewezen op beide platformen goed werkt.
    const menu = document.createElement('div');
    menu.id = 'map-actions-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${Math.max(8, rect.left - 198)}px;
        background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        min-width: 190px; z-index: 10000; overflow: hidden;
    `;
    menu.innerHTML = `
        <button id="menu-open-svr" style="
            display: block; width: 100%; padding: 12px 16px; border: none; background: none;
            text-align: left; font-size: 15px; color: #333; cursor: pointer;
        "><i class="fas fa-globe" style="width: 20px; margin-right: 8px;"></i>www.svr.nl</button>
    `;
    document.body.appendChild(menu);

    document.getElementById('menu-open-svr').addEventListener('click', () => {
        window.open('https://www.svr.nl', '_blank');
        window.toggleMapMenu();
    });

    // Sluit het menu bij een tap buiten het menu/de knop, maar pas vanaf de
    // volgende event-cyclus zodat de klik die het menu opende het niet meteen
    // weer sluit.
    setTimeout(() => {
        window._closeMapMenuOnOutsideClick = function(e) {
            const m = document.getElementById('map-actions-menu');
            if (m && !m.contains(e.target) && !btn.contains(e.target)) {
                window.toggleMapMenu();
            }
        };
        document.addEventListener('click', window._closeMapMenuOnOutsideClick);
    }, 0);
};

window.showHelp = function() {
    const dynamicText = document.getElementById('dynamic-help-text');
    if (isListView) { dynamicText.innerText = 'Terug naar boven scrollen'; }
    else { dynamicText.innerText = 'Toon jouw huidige locatie'; }
    document.getElementById('help-overlay').style.display = 'block';

    // Trigger install prompt if PWA is not installed
    if (!window.isAppInstalled() && window.showInstallPromotion) {
        window.showInstallPromotion();
    }
};

// Geen login meer nodig: de app gebruikt de open API van svr-backend en start direct.
async function initApp() {
    console.log('🚀 SVR PWA Start (API-modus, geen login nodig)');
    window.initializeApp();
}

window.initializeApp = function() {
    history.replaceState({ view: 'map' }, "");

    // Reset filters on startup
    window.currentFilters = [];
    // Clear filters cookie
    document.cookie = "filters=[]; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    // Clear cache to ensure we load the full dataset (unfiltered) on fresh start
    localStorage.removeItem('svr_cache_campsites');

    // Set version display
    const verDisplay = document.getElementById('pwa-version-display');
    if (verDisplay) verDisplay.textContent = `v${window.SVR_PWA_VERSION}`;

    // Load campingdata via de API (Single Source of Truth)
    // This renders the initial map view with all campings
    window.loadStaticCampsites();
    
    // Start background fetch of filter checkboxes (vinkjes) with a small delay
    // This ensures the initial local render gets full CPU priority first.
    setTimeout(() => {
        if (window.fetchFilterData) {
            logDebug("Starting delayed background filter fetch...");
            window.fetchFilterData();
        }
    }, 1500);

    if (!localStorage.getItem('svr_help_shown')) {
        // Only set the flag if the help screen is shown as part of the initial flow
        window.shouldShowPWAAfterHelp = true; 
        setTimeout(() => { window.showHelp(); localStorage.setItem('svr_help_shown', 'true'); }, 2500);
    } else {
        // If help screen is not shown, or already shown, trigger PWA prompt check directly
        // after a slight delay to avoid interfering with initial load.
        setTimeout(() => { 
            // Only show prompt if it hasn't been handled via initial help screen.
            // In this 'else' block, it means help was NOT shown, so the prompt should show.
            window.shouldShowPWAAfterHelp = true; // Set flag to true for direct call
            window.closeHelpOverlayAndShowPWA(); 
        }, 3000); 
    }
};

// Function to close the help overlay and potentially show PWA install prompt
window.closeHelpOverlayAndShowPWA = function() {
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
        logDebug("Help overlay gesloten.");
    }
    
    // Only show the PWA prompt if the flag is set (meaning it's part of the initial flow)
    if (window.shouldShowPWAAfterHelp && window.isAppInstalled && !window.isAppInstalled()) {
        if (window.isIOS && window.isIOS()) {
            logDebug("Platform is iOS. Toon iOS instructies na sluiten help-overlay.");
            window.showIOSInstructions();
        } else if (window.showInstallPromotion) { // For Android/Desktop
            logDebug("Attempting to show PWA install promotion after help overlay close.");
            window.showInstallPromotion();
        }
    }
    window.shouldShowPWAAfterHelp = false; // Reset the flag after checking/showing
};

$(document).ready(() => {
    initApp();
});
