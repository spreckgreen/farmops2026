function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function renderProcedureList(procedures) {
  if (procedures.length === 0) {
    return '<li class="procedure-empty">No local procedures yet. Seed one in Demo or add import/create flows next.</li>';
  }

  return procedures
    .map(
      (procedure) =>
        `<li class="procedure-item">` +
        `<h4>${escape(procedure.title)}</h4>` +
        `<p class="procedure-site">Site: <span class="value">${escape(procedure.siteId)}</span></p>` +
        `<p class="procedure-body">${escape(procedure.body)}</p>` +
        `<div class="procedure-actions">` +
        `<button type="button" data-procedure-edit="${escape(procedure.id)}">Edit</button>` +
        `<button type="button" data-procedure-delete="${escape(procedure.id)}">Delete</button>` +
        `</div>` +
        `</li>`,
    )
    .join("");
}

function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildDesktopHealthHtml({
  profileType,
  schemaVersion,
  databasePath,
  appVersion,
  backupConfigured = false,
  aiConfigured = false,
  licenseStatus = "demo-trial",
  recoveryHealth = { history: [], cleanupRequired: false, cleanup: [] },
  procedures = [],
}) {
  const latestRestore = recoveryHealth.history?.[0] ?? null;
  const warnings = [
    recoveryHealth.cleanupRequired && {
      label: "Restore rollback cleanup is required",
      target: "#recovery",
    },
    !backupConfigured && {
      label: "Backup destination is not configured",
      target: "#config-backup",
    },
    !aiConfigured && {
      label: "AI provider is not configured",
      target: "#config-ai",
    },
  ].filter(Boolean);
  const status = warnings.length ? "Setup needs attention" : "Ready";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>FarmOps Desktop Health</title>
    <style>
      :root { font-family: system-ui; color: #183126; background: #f3f6f2; }
      body { margin: 0; }
      header { background: #244d37; color: white; padding: 24px 32px; }
      main { max-width: 1100px; margin: auto; padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; }
      .card { background: white; border: 1px solid #ccd8cf; border-radius: 12px; padding: 18px; }
      .ok { color: #176b3a; }
      .warn { color: #925f00; }
      a { color: #145b37; }
      .value { font-weight: 700; word-break: break-word; }
      button { padding: 9px 12px; }
      .stack { display: flex; flex-direction: column; gap: 10px; }
      .procedure-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .procedure-item { border: 1px solid #dfe7e1; border-radius: 10px; padding: 12px; background: #f9fbf8; }
      .procedure-item h4 { margin: 0 0 6px; }
      .procedure-site { margin: 0 0 6px; font-size: 0.9rem; color: #365443; }
      .procedure-body { margin: 0; white-space: pre-wrap; }
      .procedure-empty { color: #5f6f65; }
      .muted { color: #5f6f65; font-size: 0.9rem; }
      .procedure-form { display: grid; gap: 8px; }
      .procedure-form input, .procedure-form textarea { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #ccd8cf; border-radius: 8px; font: inherit; }
      .procedure-form textarea { min-height: 88px; resize: vertical; }
      .procedure-actions { display: flex; gap: 8px; margin-top: 10px; }
    </style>
  </head>
  <body>
    <header>
      <h1>FarmOps Desktop</h1>
      <p>Offline health and setup</p>
    </header>
    <main>
      <h2 class="${warnings.length ? "warn" : "ok"}">${status}</h2>

      <section class="grid">
        <article class="card">
          <h3>Profile</h3>
          <p class="value">${escape(profileType)}</p>
          <p>Database schema ${escape(schemaVersion)}</p>
          <p>${escape(databasePath)}</p>
        </article>
        <article class="card">
          <h3>Application</h3>
          <p>Version <span class="value">${escape(appVersion)}</span></p>
          <p>License: <span class="value">${escape(licenseStatus)}</span></p>
          <a href="#subscription">Subscription &amp; modules</a>
        </article>
        <article class="card">
          <h3>Configuration health</h3>
          ${warnings.length
            ? `<ul>${warnings.map((item) => `<li>⚠ <a href="${item.target}">${escape(item.label)}</a></li>`).join("")}</ul>`
            : '<p class="ok">✓ Required setup is ready</p>'}
        </article>
      </section>

      <section class="grid" style="margin-top:16px">
        <article class="card stack" id="procedures">
          <div>
            <h3>Local procedures</h3>
            <p class="muted">Read directly from the standalone SQLite profile. This stays available without any web app or Supabase runtime.</p>
          </div>
          <div>
            <form id="create-procedure-form" class="procedure-form">
              <input id="procedure-id" name="id" type="hidden">
              <input id="procedure-title" name="title" type="text" maxlength="160" placeholder="Procedure title" aria-label="Procedure title">
              <textarea id="procedure-body" name="body" placeholder="Procedure steps or notes" aria-label="Procedure body"></textarea>
              <button id="create-procedure" type="submit">Add local procedure</button>
              <button id="cancel-procedure-edit" type="button" hidden>Cancel edit</button>
            </form>
          </div>
          <div>
            <button id="refresh-procedures" type="button">Refresh local procedures</button>
            <p id="procedures-result" aria-live="polite">Loaded ${procedures.length} local procedure${procedures.length === 1 ? "" : "s"}.</p>
          </div>
          <ul id="procedures-list" class="procedure-list">${renderProcedureList(procedures)}</ul>
        </article>

        <article class="card" id="config-backup">
          <h3>Backup</h3>
          <p>${backupConfigured ? "Configured" : "Choose a local, mounted file-server, OneDrive, or Google Drive synchronized folder."}</p>
          <button id="select-backup" type="button">Select backup destination</button>
          <button id="backup-now" type="button">Back up now</button>
          <button id="restore-preview" type="button">Select and verify backup</button>
          <button id="restore-confirm" type="button" disabled>Restore verified backup</button>
          <button id="retention-preview" type="button">Review old backups</button>
          <button id="retention-apply" type="button" disabled>Remove reviewed backups</button>
          <button id="schedule-enable" type="button">Enable daily backup</button>
          <button id="schedule-disable" type="button">Disable schedule</button>
          <p id="backup-result" aria-live="polite"></p>
        </article>

        <article class="card" id="recovery">
          <h3>Recovery history</h3>
          ${recoveryHealth.cleanupRequired
            ? `<p class="warn">⚠ ${escape(recoveryHealth.cleanup.length)} rollback folder(s) require cleanup.</p>`
            : ""}
          ${latestRestore
            ? `<p>Latest restore: <strong>${escape(latestRestore.status)}</strong></p><p>${escape(latestRestore.recordedAt)}</p>`
            : "<p>No restore attempts recorded.</p>"}
          ${recoveryHealth.cleanupRequired
            ? '<button id="cleanup-rollbacks" type="button">Remove rollback data</button><p id="recovery-result" aria-live="polite"></p>'
            : ""}
        </article>

        <article class="card" id="config-ai">
          <h3>AI provider</h3>
          <p>${aiConfigured ? "Configured" : "AI is optional. Configure BYOK, Ollama/local, or leave AI disabled."}</p>
          <button type="button">Configure AI</button>
        </article>

        <article class="card" id="subscription">
          <h3>Subscription &amp; modules</h3>
          <p>Procedures: <strong>Free for life</strong></p>
          <p>Paid modules remain visible and retain their data when locked.</p>
        </article>
      </section>
    </main>

    <script>
      const initialProcedures = ${inlineJson(procedures)};

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]);
      }

      function renderProcedures(procedures) {
        const list = document.getElementById("procedures-list");
        const result = document.getElementById("procedures-result");
        if (!list || !result) return;

        if (!procedures.length) {
          list.innerHTML = '<li class="procedure-empty">No local procedures yet. Seed one in Demo or add import/create flows next.</li>';
        } else {
          list.innerHTML = procedures
            .map((procedure) =>
              '<li class="procedure-item">' +
              '<h4>' + escapeHtml(procedure.title) + '</h4>' +
              '<p class="procedure-site">Site: <span class="value">' + escapeHtml(procedure.siteId) + '</span></p>' +
              '<p class="procedure-body">' + escapeHtml(procedure.body) + '</p>' +
              '</li>'
            )
            .join("");
        }

        result.textContent =
          "Loaded " + procedures.length + " local procedure" + (procedures.length === 1 ? "" : "s") + ".";

        list.querySelectorAll("[data-procedure-edit]").forEach((button) => {
          button.addEventListener("click", () => beginEdit(button.getAttribute("data-procedure-edit")));
        });
        list.querySelectorAll("[data-procedure-delete]").forEach((button) => {
          button.addEventListener("click", () => removeProcedure(button.getAttribute("data-procedure-delete")));
        });
      }

      function resetProcedureForm() {
        document.getElementById("procedure-id").value = "";
        document.getElementById("procedure-title").value = "";
        document.getElementById("procedure-body").value = "";
        document.getElementById("create-procedure").textContent = "Add local procedure";
        document.getElementById("cancel-procedure-edit").hidden = true;
      }

      function beginEdit(id) {
        const item = currentProcedures.find((procedure) => procedure.id === id);
        if (!item) return;
        document.getElementById("procedure-id").value = item.id;
        document.getElementById("procedure-title").value = item.title;
        document.getElementById("procedure-body").value = item.body;
        document.getElementById("create-procedure").textContent = "Save procedure";
        document.getElementById("cancel-procedure-edit").hidden = false;
      }

      async function removeProcedure(id) {
        const result = document.getElementById("procedures-result");
        if (!window.farmopsDesktop?.deleteProcedure) {
          result.textContent = "Desktop procedures service is unavailable.";
          return;
        }

        result.textContent = "Removing local procedure…";
        try {
          const payload = await window.farmopsDesktop.deleteProcedure({ id });
          currentProcedures = payload?.procedures ?? [];
          renderProcedures(currentProcedures);
          resetProcedureForm();
          result.textContent = "Local procedure removed.";
        } catch (error) {
          result.textContent = error instanceof Error ? error.message : "Procedure delete failed.";
        }
      }

      let currentProcedures = initialProcedures;

      renderProcedures(currentProcedures);

      document.getElementById("create-procedure-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = document.getElementById("procedures-result");
        const id = document.getElementById("procedure-id");
        const title = document.getElementById("procedure-title");
        const body = document.getElementById("procedure-body");
        const isEditing = Boolean(id.value);
        const action = isEditing ? window.farmopsDesktop?.updateProcedure : window.farmopsDesktop?.createProcedure;
        if (!action) {
          result.textContent = "Desktop procedures service is unavailable.";
          return;
        }

        result.textContent = isEditing ? "Saving local procedure changes…" : "Saving local procedure…";
        try {
          const payload = await action({
            id: id.value,
            title: title.value,
            body: body.value,
          });
          currentProcedures = payload?.procedures ?? [];
          renderProcedures(currentProcedures);
          resetProcedureForm();
          result.textContent = isEditing ? "Local procedure updated." : "Local procedure saved.";
        } catch (error) {
          result.textContent = error instanceof Error ? error.message : "Procedure save failed.";
        }
      });

      document.getElementById("cancel-procedure-edit").addEventListener("click", () => {
        resetProcedureForm();
        document.getElementById("procedures-result").textContent =
          "Loaded " + currentProcedures.length + " local procedure" + (currentProcedures.length === 1 ? "" : "s") + ".";
      });

      document.getElementById("refresh-procedures").addEventListener("click", async () => {
        const result = document.getElementById("procedures-result");
        if (!window.farmopsDesktop?.listProcedures) {
          result.textContent = "Desktop procedures service is unavailable.";
          return;
        }

        result.textContent = "Refreshing local procedures…";
        const payload = await window.farmopsDesktop.listProcedures();
        currentProcedures = payload?.procedures ?? [];
        renderProcedures(currentProcedures);
        resetProcedureForm();
      });

      document.getElementById("select-backup").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        if (!window.farmopsDesktop) {
          output.textContent = "Desktop setup service is unavailable.";
          return;
        }
        output.textContent = "Checking destination…";
        const result = await window.farmopsDesktop.selectBackupDestination();
        if (result.configured) {
          output.textContent = "✓ Backup destination ready: " + result.destination.directory;
        } else if (result.canceled) {
          output.textContent = "No folder selected.";
        } else {
          output.textContent = "⚠ " + result.error;
        }
      });

      document.getElementById("backup-now").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        output.textContent = "Creating and verifying backup…";
        const result = await window.farmopsDesktop?.backupNow();
        output.textContent = result?.ok
          ? "✓ Verified backup: " + result.path + " (" + result.verification.valid + ")"
          : "⚠ " + (result?.error ?? "Desktop backup service is unavailable.");
      });

      document.getElementById("restore-preview").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        output.textContent = "Reading and verifying backup…";
        const result = await window.farmopsDesktop?.selectRestorePreview();
        const restoreButton = document.getElementById("restore-confirm");
        restoreButton.disabled = true;
        if (result?.canceled) {
          output.textContent = "No backup selected.";
        } else if (result?.valid) {
          restoreButton.disabled = false;
          output.textContent =
            "✓ Compatible backup from " +
            result.createdAt +
            "; schema " +
            result.schemaVersion +
            "; " +
            result.fileCount +
            " files. No data has been changed.";
        } else {
          output.textContent = "⚠ Backup cannot be restored: " + (result?.reason ?? "Desktop restore service is unavailable.");
        }
      });

      document.getElementById("restore-confirm").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        output.textContent = "Waiting for restore confirmation…";
        const result = await window.farmopsDesktop?.confirmRestore();
        if (result?.canceled) {
          output.textContent = "Restore canceled. No data was changed.";
        } else if (!result?.ok) {
          output.textContent = "⚠ Restore not started: " + (result?.reason ?? "Desktop restore service is unavailable.");
        }
      });

      ${recoveryHealth.cleanupRequired
        ? `document.getElementById("cleanup-rollbacks").addEventListener("click", async () => {
        const output = document.getElementById("recovery-result");
        output.textContent = "Waiting for confirmation…";
        const result = await window.farmopsDesktop?.cleanupRestoreRollbacks();
        if (result?.canceled) {
          output.textContent = "Cleanup canceled.";
        } else if (result?.ok) {
          output.textContent = "✓ Removed " + result.removedCount + " rollback folder(s).";
          document.getElementById("cleanup-rollbacks").disabled = true;
        } else {
          output.textContent = "⚠ " + (result?.reason ?? "Rollback cleanup is unavailable.");
        }
      });`
        : ""}

      document.getElementById("retention-preview").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        const apply = document.getElementById("retention-apply");
        apply.disabled = true;
        output.textContent = "Checking verified backup history…";
        const result = await window.farmopsDesktop?.previewBackupRetention();
        if (result?.ok) {
          apply.disabled = result.removableCount === 0;
          output.textContent =
            "Keep " +
            result.protectedCount +
            " verified backup(s); " +
            result.removableCount +
            " old backup(s) eligible; " +
            result.invalidCount +
            " invalid archive(s) preserved.";
        } else {
          output.textContent = "⚠ " + (result?.reason ?? "Retention preview is unavailable.");
        }
      });

      document.getElementById("retention-apply").addEventListener("click", async () => {
        const output = document.getElementById("backup-result");
        output.textContent = "Waiting for confirmation…";
        const result = await window.farmopsDesktop?.applyBackupRetention();
        if (result?.canceled) {
          output.textContent = "Retention canceled. No backups were removed.";
        } else if (result?.ok) {
          output.textContent = "✓ Removed " + result.removedCount + " reviewed backup(s).";
          document.getElementById("retention-apply").disabled = true;
        } else {
          output.textContent = "⚠ " + (result?.reason ?? "Backup retention failed.");
        }
      });

      async function setSchedule(enabled) {
        const output = document.getElementById("backup-result");
        output.textContent = enabled ? "Enabling daily verified backups…" : "Disabling automatic backups…";
        const result = await window.farmopsDesktop?.setBackupScheduleEnabled(enabled);
        output.textContent = result?.ok
          ? (result.schedule.enabled ? "✓ Daily automatic backups enabled." : "Automatic backups disabled.")
          : "⚠ " + (result?.reason ?? "Schedule service unavailable.");
      }

      document.getElementById("schedule-enable").addEventListener("click", () => setSchedule(true));
      document.getElementById("schedule-disable").addEventListener("click", () => setSchedule(false));
    </script>
  </body>
</html>`;
}