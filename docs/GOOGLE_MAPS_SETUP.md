# Configuring Google Maps for Site Grids

Site Grids (`/electrical/site-grids`) uses Google Maps in two separate ways, and each
needs its **own** key:

| Where it runs | Key | Used for | Restriction |
|---|---|---|---|
| Browser | public **browser key** | aerial imagery you trace building corners on | HTTP referrer restricted |
| Server | private **server key** | turning the site address into rooftop coordinates (geocoding) | no referrer restriction; "None" or IP addresses |

A referrer-restricted key can never geocode from the server: Google replies
`REQUEST_DENIED`. One key cannot do both jobs. This is the single most common
setup mistake.

In code:

- browser: `src/lib/google-maps-loader.ts` reads
  `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` and loads the Maps JavaScript API
  asynchronously with a callback.
- server: `geocodeSiteAddress` in `src/lib/site-plan.functions.ts` calls the connector
  gateway with `GOOGLE_MAPS_API_KEY`; nothing calls Google directly.

## 1. Prepare the Google Cloud project

Once per organisation:

1. Create (or pick) a Google Cloud project.
2. Enable **billing** on it. Maps APIs refuse to serve without billing, even inside
   the free monthly allowance.
3. Enable these APIs:
   - **Maps JavaScript API** — the aerial view.
   - **Geocoding API** — address → rooftop coordinates.
   - Add **Places API (New)** only if you later want address autocomplete.

## 2. Create the public browser key

1. **APIs & Services → Credentials → Create credentials → API key**.
2. Name it something like `farmops-browser`.
3. **Application restrictions → Websites**, and add every host that serves the app.
   Root and subdomains are separate patterns, so add both:

   ```text
   https://farmops.bostead.life/*
   https://*.bostead.life/*
   https://*.lovable.app/*
   ```

4. **API restrictions → Restrict key →** Maps JavaScript API (plus Places API (New)
   if used).

This key is embedded in the page. That is expected and safe: the referrer list is
what protects it.

## 3. Create the private server key

1. Create a **second** API key, e.g. `farmops-server`.
2. **Application restrictions → None** (or *IP addresses* if your host has a fixed
   egress IP). Server calls send no referrer, so a website restriction blocks them.
3. **API restrictions → Restrict key →** Geocoding API.
4. Never put this key in front-end code, a URL, or a screenshot.

## 4a. Connect the keys — hosted install

Both keys are supplied through the Google Maps connector, not by editing files:

1. Ask the assistant to open the Google Maps connector.
2. Choose **New connection → Use your own credentials**.
3. Paste the **browser** key in the browser/public field and the **server** key in
   the server/secret field.

After the connection is linked the values arrive as environment variables:
`VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` (client) and
`GOOGLE_MAPS_API_KEY` (server, used with `LOVABLE_API_KEY` against the gateway).
Publish the app so the published site picks up the browser key.

## 4b. Configure the keys — self-hosted install

There is no connector on a self-hosted box, so both keys come from `.env`:

```bash
# .env (project root, next to docker-compose.yml)
VITE_GOOGLE_MAPS_BROWSER_KEY=AIza...browser-key
GOOGLE_MAPS_API_KEY=AIza...server-key
```

Then rebuild, because the browser key is baked into the page at build time —
restarting alone is not enough:

```bash
docker compose up -d --build app
```

Notes specific to self-hosting:

- The browser key's website list must contain the host you actually browse,
  e.g. `https://farmops.example.com/*` **and** `https://*.example.com/*`.
  A LAN address such as `http://192.168.1.20:3000/*` also has to be listed if
  you use it.
- `LOVABLE_API_KEY` stays empty. With no gateway key the server calls
  Google's Geocoding API directly with `GOOGLE_MAPS_API_KEY`, so the server key
  must have **Application restrictions → None** (or your box's egress IP) and
  Geocoding API allowed.
- `GOOGLE_MAPS_API_KEY` is read at request time, so a change to it only needs
  `docker compose up -d app`; a change to the browser key needs `--build`.

## 5. Verify

1. Open **Electrical → Diagrams & maps → Site grids**.
2. Type the site address and press the lookup. A successful geocode returns a
   formatted address plus latitude/longitude — that proves the **server** key.
3. The aerial should appear centred on the roof — that proves the **browser** key.
4. Click the building corners; each click adds a numbered corner, and **Finish this
   building** stores the footprint, perimeter and orientation in feet.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Map area blank, console shows `RefererNotAllowedMapError` | the current domain is not in the browser key's website list | add `https://domain/*` **and** `https://*.domain/*` |
| Address lookup fails with `REQUEST_DENIED` | the server key is referrer restricted, or Geocoding API is not on its allowed list | set the server key's application restriction to None/IP and allow Geocoding API |
| "Address lookup was denied (403)" in FarmOps | same as above; FarmOps relays Google's status | as above |
| "Map lookup is not configured for this project yet" | no connection linked, so the server key is absent | link the Google Maps connector |
| "The map is not connected for this project yet" | the browser key is missing from the build | link the connector, then publish |
| `BillingNotEnabledMapError` | billing off on the Cloud project | enable billing |
| Map works in preview but not on the custom domain | the built-in managed key only allows `*.lovable.app` / `*.lovableproject.com` | use your own keys as above |

Manual corner entry always works, with no key at all, so a building can be defined
even while the map is unavailable.

## 7. Cost control

- Keep the server key restricted to Geocoding only; a leaked unrestricted key is
  billable.
- Addresses are geocoded on demand, one call per lookup — do not put the lookup on
  a page that loads automatically in a loop.
- Set a **budget alert** on the Cloud project, and quotas per API under
  **APIs & Services → Quotas**.
- Rotate a key by creating a new one, reconnecting the connector, then deleting the
  old key in Google Cloud.
