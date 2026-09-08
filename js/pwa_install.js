// Version tracking for cache busting
const APP_VERSION = "0.2.58";

// ============================================================
// pwa_install.js
// Betrouwbare PWA install flow:
// - Race condition fix: deferredPrompt wordt altijd opgeslagen,
//   knop wordt enabled zodra DOM beschikbaar is.
// - Geen localStorage 'installed' vlag: alleen display-mode
//   en navigator.standalone worden gebruikt.
// - Banner wordt getoond via window.closeHelpOverlayAndShowPWA()
// - iOS krijgt aparte instructies.
// ============================================================

let deferredPrompt = null;
let installBanner, installButton, closeBanner;

// ------------------------------------------------------------
// Debug logging
// ------------------------------------------------------------
function logDebug(msg) {
    console.log(`[PWA_INSTALL] ${msg}`);
}

// ------------------------------------------------------------
// Betrouwbare installed check — GEEN localStorage
// ------------------------------------------------------------
function isAppInstalled() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIosStandalone = (window.navigator.standalone === true);
    logDebug(`isAppInstalled(): standalone=${isStandalone}, ios=${isIosStandalone}`);
    return isStandalone || isIosStandalone;
}
window.isAppInstalled = isAppInstalled;

// ------------------------------------------------------------
// Dismissal voorkeur (banner wegklikken, niet installeren)
// ------------------------------------------------------------
function shouldShowBannerAgain() {
    const dismissedDate = localStorage.getItem('install-banner-dismissed-date');
    if (dismissedDate) {
        const daysSince = (Date.now() - parseInt(dismissedDate)) / (1000 * 60 * 60 * 24);
        if (daysSince < 90) {
            logDebug(`Banner afgewezen ${Math.floor(daysSince)} dagen geleden. Wacht nog.`);
            return false;
        }
        logDebug('90 dagen verstreken sinds dismissal. Toon opnieuw.');
    }
    return true;
}

function markBannerDismissed() {
    localStorage.setItem('install-banner-dismissed-date', Date.now().toString());
    logDebug('Banner dismissal opgeslagen.');
}

// ------------------------------------------------------------
// Enable install button (gedeeld door beforeinstallprompt
// en DOMContentLoaded zodat race condition wordt opgevangen)
// ------------------------------------------------------------
function enableInstallButton() {
    if (installButton) {
        installButton.disabled = false;
        installButton.textContent = 'Installeren';
        logDebug('Installatieknop geactiveerd.');
    }
}

// ------------------------------------------------------------
// Banner tonen / verbergen
// ------------------------------------------------------------
function showInstallPromotion() {
    logDebug('showInstallPromotion() aangeroepen.');

    if (isAppInstalled()) {
        logDebug('App is al geïnstalleerd. Banner niet tonen.');
        return;
    }

    if (!shouldShowBannerAgain()) {
        logDebug('Banner mag nog niet opnieuw worden getoond.');
        return;
    }

    if (!deferredPrompt) {
        logDebug('deferredPrompt is null — Chrome biedt installatie nu niet aan.');
        // Optioneel: toon een uitleg aan de gebruiker
        // bijv. "Voeg toe via browsermenu" — hier niet geïmplementeerd
        return;
    }

    if (installBanner) {
        installBanner.style.display = 'flex';
        logDebug('Installatiebanner getoond.');
    }
}
window.showInstallPromotion = showInstallPromotion;

function hideInstallPromotion() {
    if (installBanner) {
        installBanner.style.display = 'none';
        logDebug('Installatiebanner verborgen.');
    }
}

// ------------------------------------------------------------
// beforeinstallprompt — fired door Chrome/Android
// Kan vóór DOMContentLoaded firen (race condition)
// ------------------------------------------------------------
window.addEventListener('beforeinstallprompt', (e) => {
    logDebug('beforeinstallprompt event afgevuurd.');
    e.preventDefault();
    deferredPrompt = e;

    // Als DOM al geladen is, enable direct
    // Anders doet DOMContentLoaded het via de check onderaan
    enableInstallButton();
});

// ------------------------------------------------------------
// appinstalled — fired door Chrome na succesvolle installatie
// ------------------------------------------------------------
window.addEventListener('appinstalled', () => {
    logDebug('PWA succesvol geïnstalleerd (appinstalled event).');
    deferredPrompt = null;
    hideInstallPromotion();
});

// ------------------------------------------------------------
// iOS detectie
// ------------------------------------------------------------
function isIOS() {
    const result = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    logDebug(`isIOS(): ${result}`);
    return result;
}
window.isIOS = isIOS;

// ------------------------------------------------------------
// iOS installatie-instructies
// ------------------------------------------------------------
function showIOSInstructions() {
    logDebug('showIOSInstructions() aangeroepen.');

    if (isAppInstalled()) {
        logDebug('App al geïnstalleerd. iOS instructies niet tonen.');
        return;
    }

    if (!shouldShowBannerAgain()) {
        logDebug('iOS instructies mogen nog niet opnieuw worden getoond.');
        return;
    }

    if (document.getElementById('ios-install-instructions')) {
        logDebug('iOS instructies al zichtbaar.');
        return;
    }

    const html = `
        <div id="ios-install-instructions" class="ios-install-instructions">
            <div class="ios-install-header-row">
                <div class="ios-install-left">
                    <div class="ios-install-icon">
                        <img src="icons/icon-192.webp" alt="App Icon">
                    </div>
                </div>
                <div class="ios-install-right">
                    <button id="close-ios-instructions" class="ios-close-button">✕</button>
                </div>
            </div>
            <p class="ios-install-main-text">Installeer de SVR app als volgt:</p>
            <div class="ios-install-detailed-instructions">
                <ol>
                    <li>Tik op de drie-puntjes ... onderin de browser en tik op het deel-icoon
                        <span style="display:inline-flex;align-items:center;vertical-align:middle;font-size:1.5em;width:24px;height:24px;">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" style="display:block;width:100%;height:100%;">
                                <line x1="40" y1="96" x2="100" y2="96"/>
                                <line x1="156" y1="96" x2="216" y2="96"/>
                                <line x1="40" y1="96" x2="40" y2="224"/>
                                <line x1="216" y1="96" x2="216" y2="224"/>
                                <line x1="40" y1="224" x2="216" y2="224"/>
                                <line x1="128" y1="160" x2="128" y2="32"/>
                                <line x1="128" y1="32" x2="96" y2="64"/>
                                <line x1="128" y1="32" x2="160" y2="64"/>
                            </svg>
                        </span>
                        (soms is drie-puntjes klikken niet nodig)
                    </li>
                    <li>Swipe omhoog, scroll naar beneden en tik op 'Zet op beginscherm'. (soms is swipe niet nodig)</li>
                    <li>Tik rechtsboven op 'Voeg toe'.</li>
                </ol>
            </div>
            <button id="ios-understood-button" class="ios-close-button">Begrepen</button>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // "Begrepen" — sla dismissal op
    document.getElementById('ios-understood-button').addEventListener('click', () => {
        logDebug('iOS instructies gesloten via Begrepen.');
        document.getElementById('ios-install-instructions').remove();
        markBannerDismissed();
    });

    // Kruisje — sluit zonder dismissal op te slaan
    document.getElementById('close-ios-instructions').addEventListener('click', () => {
        logDebug('iOS instructies gesloten via kruisje (geen dismissal opgeslagen).');
        document.getElementById('ios-install-instructions').remove();
    });

    logDebug('iOS installatie-instructies getoond.');
}

// ------------------------------------------------------------
// closeHelpOverlayAndShowPWA — aangeroepen vanuit de app
// ------------------------------------------------------------
window.closeHelpOverlayAndShowPWA = function () {
    logDebug('closeHelpOverlayAndShowPWA() aangeroepen.');

    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
    }

    if (isAppInstalled()) {
        logDebug('App al geïnstalleerd. Geen prompt tonen.');
        return;
    }

    if (!shouldShowBannerAgain()) {
        logDebug('Banner mag nog niet opnieuw worden getoond.');
        return;
    }

    if (isIOS()) {
        showIOSInstructions();
    } else {
        showInstallPromotion();
    }
};

// ------------------------------------------------------------
// DOMContentLoaded
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    logDebug('DOMContentLoaded.');

    installBanner = document.getElementById('install-banner');
    installButton = document.getElementById('install-button');
    closeBanner   = document.getElementById('close-banner');

    // Race condition fix: als beforeinstallprompt al eerder fired,
    // enable de knop alsnog nu de DOM beschikbaar is.
    if (deferredPrompt) {
        logDebug('deferredPrompt was al gezet vóór DOMContentLoaded. Knop alsnog activeren.');
        enableInstallButton();
    }

    // Install knop
    if (installButton) {
        installButton.addEventListener('click', async () => {
            logDebug('Installatieknop geklikt.');
            if (!deferredPrompt) {
                logDebug('deferredPrompt is null. Installatie niet mogelijk.');
                return;
            }

            installButton.disabled = true;
            installButton.textContent = 'Bezig...';

            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            logDebug(`Gebruikerskeuze: ${outcome}`);

            deferredPrompt = null;
            hideInstallPromotion();

            if (outcome === 'dismissed') {
                markBannerDismissed();
            }
            // Bij 'accepted' doet het appinstalled-event de rest
        });
    }

    // Sluitknop banner (kruisje) — geen dismissal opslaan
    if (closeBanner) {
        closeBanner.addEventListener('click', () => {
            logDebug('Banner gesloten via kruisje (geen dismissal opgeslagen).');
            hideInstallPromotion();
        });
    }

    // iOS: toon direct bij laden als nog niet geïnstalleerd
    if (!isAppInstalled() && shouldShowBannerAgain() && isIOS()) {
        logDebug('iOS: instructies direct tonen bij laden.');
        showIOSInstructions();
    }
});
