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

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps can only load in the browser."));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as
    | string
    | undefined;
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
