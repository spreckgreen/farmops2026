# Unwrap a YubiKey-wrapped VAULT_ENCRYPTION_KEY

When you "Export encryption key" from the Bostead admin UI you get a
`vault-key-export-*.json` file. This folder contains the offline helper
needed to recover the plaintext `VAULT_ENCRYPTION_KEY` on a self-hosted
Docker instance.

## Requirements

- The **same physical YubiKey** that was used to wrap the file
  (FIDO2, 5 series or newer — must support the `hmac-secret` extension).
- A recent Chrome, Edge, or Safari with WebAuthn support.
- The helper must run on the **same hostname (rpId)** the YubiKey was enrolled
  against. The rpId is recorded inside the export file.

## Steps

1. Copy `unwrap.html` and your `vault-key-export-*.json` to a trusted machine
   that is allowed to talk to your YubiKey.
2. Serve the page from the matching hostname. The simplest options:
   - **Same browser/laptop as enrollment** (rpId is the Lovable preview /
     published domain): open `unwrap.html` from that browser; you may need to
     host it on the same domain. If you used `localhost` for enrollment, run
     `python3 -m http.server 8080` in this folder and open
     `http://localhost:8080/unwrap.html`.
   - **Different host**: temporarily add a `127.0.0.1 <rpId>` entry to
     `/etc/hosts` and serve via HTTPS (browsers require HTTPS for non-localhost
     WebAuthn).
3. Select the exported JSON file in the page.
4. Click **Unwrap key** and touch your YubiKey.
5. Copy the displayed `VAULT_ENCRYPTION_KEY` value and set it in your Docker
   environment, e.g.:

   ```yaml
   # docker-compose.yml
   services:
     bostead:
       environment:
         VAULT_ENCRYPTION_KEY: "PASTE_HERE"
   ```

   Or via CLI: `docker run -e VAULT_ENCRYPTION_KEY=... bostead`.

6. Restart the container. Snapshot restore can now decrypt vault rows.

## Safety

- The decrypted key never leaves the browser — no network calls are made by
  this helper.
- Treat the JSON file as recoverable-with-YubiKey only: anyone with both the
  file **and** your YubiKey can recover the key.
- Enroll at least two YubiKeys before relying on this for disaster recovery,
  in case one is lost.
- Never commit the export file or the decrypted key to git.
