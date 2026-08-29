/**
 * Platform detection for the AR viewer.
 *
 * Android and iOS resolve "view in AR" through completely different native
 * pipelines, so a single generic viewer can't serve both well:
 *
 *  - Android/Chrome hands off to Google's Scene Viewer via an
 *    `intent://arvr.google.com/...` link. Scene Viewer consumes glTF/GLB
 *    directly -- which is exactly what <model-viewer src="..."> already
 *    provides, so ARViewerModelViewer needs no changes for Android.
 *
 *  - iOS/Safari hands off to Apple's AR Quick Look, which is triggered by a
 *    real user gesture on an `<a rel="ar">` link (or model-viewer's
 *    equivalent `ios-src` + activateAR()) and *only* accepts USDZ/Reality
 *    files. It also renders lighting/shadows itself via ARKit, so the
 *    model-viewer scene props that matter on Android (environment-image,
 *    shadow-intensity) are irrelevant once Quick Look actually launches --
 *    they only affect the pre-AR 3D preview.
 *
 * This module is intentionally dependency-free (no UA-parser libraries) so
 * it can be imported from the top-level router without pulling in anything
 * heavy.
 */

export const PLATFORM = {
  IOS: 'ios',
  ANDROID: 'android',
  DESKTOP: 'desktop',
  UNKNOWN: 'unknown',
};

/**
 * True on iPhone/iPod/"classic" iPad user agents, and on iPadOS 13+, which
 * masquerades as `navigator.platform === 'MacIntel'` (Apple made iPadOS
 * Safari report itself as desktop Safari for site-compatibility reasons).
 * The standard way to tell an iPad apart from an actual Intel Mac is that
 * real Macs never report more than 1 touch point (they have no touch
 * screen), while an iPad always does.
 */
export function isIOS(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!nav) return false;
  const ua = nav.userAgent || nav.vendor || '';

  const isClassicIOSUA = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus =
    nav.platform === 'MacIntel' &&
    typeof nav.maxTouchPoints === 'number' &&
    nav.maxTouchPoints > 1;

  return isClassicIOSUA || isIPadOS13Plus;
}

export function isAndroid(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!nav) return false;
  const ua = nav.userAgent || nav.vendor || '';
  return /Android/i.test(ua);
}

/**
 * Resolves the platform bucket to route the AR viewer for.
 * iOS is checked first since some in-app iOS browsers spoof pieces of an
 * Android-looking UA string for compatibility shims -- the touch-point
 * heuristic above is more reliable than a raw substring match either way.
 */
export function getPlatform(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (isIOS(nav)) return PLATFORM.IOS;
  if (isAndroid(nav)) return PLATFORM.ANDROID;

  if (nav && /Win|Mac|Linux/.test(nav.platform || '')) {
    return PLATFORM.DESKTOP;
  }
  return PLATFORM.UNKNOWN;
}

/**
 * Feature-detects whether this browser can actually launch AR Quick Look
 * (as opposed to merely running on iOS -- e.g. an iOS browser embedded
 * inside another app's in-app WebView frequently can't). Quick Look
 * support is advertised via `HTMLAnchorElement.relList.supports('ar')`.
 */
export function supportsQuickLook() {
  if (typeof document === 'undefined' || !isIOS()) return false;
  try {
    const el = document.createElement('a');
    return Boolean(el.relList && el.relList.supports && el.relList.supports('ar'));
  } catch {
    return false;
  }
}

/**
 * Detects the common "in-app browser" WebViews (Instagram, Facebook,
 * TikTok, LINE, etc.) that most iOS AR/QR-code traffic actually arrives
 * through. Quick Look is a Safari/SFSafariViewController feature -- Apple
 * does not let third-party in-app WebViews present it, no matter what the
 * page does -- so the iOS viewer uses this to show a "open in Safari" hint
 * instead of silently failing when the user taps "View in AR".
 */
export function isInAppBrowser(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!nav) return false;
  const ua = nav.userAgent || nav.vendor || '';
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|Twitter/i.test(ua);
}
