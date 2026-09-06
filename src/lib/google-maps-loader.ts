/// <reference types="google.maps" />
// Loads the Google Maps JavaScript API once, in the browser only.
//
// The browser key is referrer-restricted and safe to embed. Loading is async
// with a callback, because google.maps.Map is not available at script onload.
let loadPromise: Promise<typeof google.maps> | null = null;

declare global {
  interface Window {
    __farmopsMapsReady?: () => void;
    google?: typeof google;
  }
}

/**
 * Which browser key this page actually loaded, and its last four characters —
 * enough to compare against the key in Google Cloud without exposing it.
 */
export function browserMapKeyHint(): string {
  const own = import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  const managed = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as
    | string
    | undefined;
  const key = own || managed;
  if (!key) return "No map key is built into this page.";
  const tail = key.slice(-4);
  return own
    ? `This page was built with your own map key (ending ${tail}), set as VITE_GOOGLE_MAPS_BROWSER_KEY.`
    : `This page is using the built-in map key (ending ${tail}), which only allows Lovable addresses. Set VITE_GOOGLE_MAPS_BROWSER_KEY to your own key and rebuild.`;
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps can only load in the browser."));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  // Self-hosted installs supply their own browser key as
  // VITE_GOOGLE_MAPS_BROWSER_KEY; hosted installs get the connector variable.
  const key = (import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] ||
    import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"]) as string | undefined;
  const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] as
    | string
    | undefined;
  if (!key) {
    return Promise.reject(
      new Error("The map is not connected for this project yet, so imagery cannot load."),
    );
  }

  loadPromise = new Promise((resolve, reject) => {
    window.__farmopsMapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("The map failed to start."));
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      loading: "async",
      callback: "__farmopsMapsReady",
      libraries: "geometry",
    });
    if (channel) params.set("channel", channel);
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () =>
      reject(new Error("The map imagery could not be loaded. Check the site's map access."));
    document.head.appendChild(script);
  });
  return loadPromise;
}
