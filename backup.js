const SCRIPT = "/usr/local/share/cockpit/cockpit-apps/scripts/backup.py3";
const jobsTable = document.querySelector("#jobs-table");
const jobModal = new bootstrap.Modal("#job-modal");
const logsModal = new bootstrap.Modal("#logs-modal");
const directoryModal = new bootstrap.Modal("#directory-modal");
let refreshTimer;
let detailTimer;
let selectedDirectoryInput;
let currentDirectory;
const diagnostics = [];

function recordDiagnostic(level, message) {
  diagnostics.push(`${new Date().toISOString()} [${level.toUpperCase()}] ${message}`);
  if (diagnostics.length > 200) diagnostics.shift();
  document.querySelector("#diagnostic-output").textContent = diagnostics.join("\n");
  console[level === "error" ? "error" : "info"](`[Backup] ${message}`);
}

function run(action, args = [], input) {
  const started = performance.now();
  recordDiagnostic("info", `Starting ${action}${args.length ? ` (${args.join(", ")})` : ""}`);
  const process = cockpit.spawn([SCRIPT, action, ...args], { err: "message", input });
  let timeoutId;
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => { process.close("timeout"); reject(new Error(`${action} timed out after 30 seconds. Check the Diagnostics panel and systemd journal.`)); }, 30000); });
  return Promise.race([process, timeout]).then(output => {
    const result = JSON.parse(output);
    if (!result.ok) throw new Error(result.error || `${action} failed without a detailed error.`);
    recordDiagnostic("info", `${action} completed in ${Math.round(performance.now() - started)} ms`);
    return result;
  }).catch(error => {
    recordDiagnostic("error", `${action} failed after ${Math.round(performance.now() - started)} ms: ${error.message || error}`);
    throw error;
  }).finally(() => clearTimeout(timeoutId));
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function alert(message, type = "danger") {
  const item = document.createElement("div"); item.className = `alert alert-${type} alert-dismissible fade show`; item.textContent = message;
  const close = document.createElement("button"); close.type = "button"; close.className = "btn-close"; close.dataset.bsDismiss = "alert"; item.append(close);
  document.querySelector("#alert-area").replaceChildren(item);
}
function statusLabel(job) {
  if (job.status?.running) return '<span class="badge text-bg-primary">Running</span>';
  if (job.status?.result === "failed") return '<span class="badge text-bg-danger">Failed</span>';
  return '<span class="badge text-bg-secondary">Stopped</span>';
}
function lastRun(job) {
  if (!job.lastRun) return "Not run yet";
  return `${job.lastRun.status === "success" ? "Succeeded" : "Failed"}: ${new Date(job.lastRun.at).toLocaleString()}`;
}
function renderSummary(jobs) {
  const latest = jobs.filter(job => job.lastRun?.at).sort((a, b) => new Date(b.lastRun.at) - new Date(a.lastRun.at))[0];
  document.querySelector("#total-count").textContent = jobs.length;
  document.querySelector("#enabled-count").textContent = jobs.filter(job => job.enabled).length;
  document.querySelector("#running-count").textContent = jobs.filter(job => job.status?.running).length;
  document.querySelector("#last-result").textContent = latest ? lastRun(latest) : "No executions";
}
async function load() {
  try {
    const { jobs } = await run("list"); renderSummary(jobs); jobsTable.replaceChildren(); document.querySelector("#empty-state").hidden = jobs.length > 0;
    for (const job of jobs) {
      const row = document.createElement("tr");
      row.innerHTML = `<td class="fw-semibold">${escapeHtml(job.name)}</td><td>${job.mode === "snapshot" ? "ZFS snapshot" : escapeHtml(job.source)}</td><td>${job.mode === "snapshot" ? "—" : escapeHtml(job.destination)}</td><td>${job.enabled ? escapeHtml(job.onCalendar || "") : "Paused"}</td><td>${statusLabel(job)}</td><td>${escapeHtml(lastRun(job))}</td><td class="text-end job-actions"><button class="btn btn-sm btn-outline-primary" data-action="run">Run</button> <button class="btn btn-sm btn-outline-secondary" data-action="edit">Edit</button> <button class="btn btn-sm btn-outline-secondary" data-action="logs">Logs</button> <button class="btn btn-sm btn-outline-danger" data-action="delete">Remove</button></td>`;
      row.dataset.job = JSON.stringify(job); jobsTable.append(row);
    }
  } catch (error) { alert(error.message); }
}
function startPolling() { clearInterval(refreshTimer); load(); refreshTimer = setInterval(load, 5000); }
function field(name, label, value = "", type = "text", required = true) { return `<div class="mb-3"><label class="form-label" for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" class="form-control" value="${escapeHtml(value)}" ${required ? "required" : ""}></div>`; }
function scheduleKind(calendar) { return { "*-*-* 00/2:00:00": "every-2", "*-*-* 00/6:00:00": "every-6", "*-*-* 02:00:00": "daily" }[calendar] || "custom"; }

async function openWizard(job = null, initialStep = 0) {
  clearInterval(detailTimer);
  const draft = { id: job?.id || crypto.randomUUID(), name: job?.name || "Backup", mode: job?.mode || "rsync", source: job?.source || "/root", destination: job?.destination || "/backup", enabled: job?.enabled ?? true, onCalendar: job?.onCalendar || "*-*-* 02:00:00", scheduleKind: scheduleKind(job?.onCalendar || "*-*-* 02:00:00"), snapshotSource: job?.snapshotSource || false, snapshotDestination: job?.snapshotDestination || false, snapshotRetention: Number(job?.snapshotRetention ?? 14), lastRun: job?.lastRun || null };
  let step = initialStep;
  document.querySelector("#form-title").textContent = job ? `Edit backup: ${job.name}` : "New backup";
  const form = document.querySelector("#job-form");
  const body = document.querySelector("#form-fields");
  const footer = form.querySelector(".modal-footer");
  async function render() {
    clearInterval(detailTimer); body.replaceChildren(); footer.replaceChildren();
    const progress = document.createElement("p"); progress.className = "text-body-secondary small"; progress.textContent = `Step ${step + 1} of 4`; body.append(progress);
    if (step === 0) renderPaths(body, draft);
    if (step === 1) renderSchedule(body, draft);
    if (step === 2) await renderSnapshots(body, draft);
    if (step === 3) await renderReview(body, draft);
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn btn-secondary"; cancel.textContent = "Cancel"; cancel.onclick = () => jobModal.hide(); footer.append(cancel);
    if (step) { const back = document.createElement("button"); back.type = "button"; back.className = "btn btn-outline-secondary"; back.textContent = "Back"; back.onclick = async () => { if (readStep(body, draft, step)) { step--; await render(); } }; footer.append(back); }
    const advance = async next => {
      if (!readStep(body, draft, step)) return;
      if (step < 3) { step++; await render(); return; }
      next.disabled = true;
      next.textContent = "Saving...";
      try {
        await run("save", [], JSON.stringify(draft));
        clearInterval(detailTimer);
        jobModal.hide();
        alert("Backup saved and timer updated.", "success");
        await load();
      } catch (error) {
        alert(error.message || "The schedule could not be saved.");
        next.disabled = false;
        next.textContent = "Save schedule";
      }
    };
    const next = document.createElement("button"); next.type = step === 3 ? "submit" : "button"; next.className = "btn btn-primary"; next.textContent = step === 3 ? "Save schedule" : "Next";
    if (step === 3) form.onsubmit = event => { event.preventDefault(); void advance(next); };
    else next.addEventListener("click", () => { void advance(next); });
    footer.append(next);
  }
  await render(); jobModal.show();
}
function renderPaths(body, draft) {
  body.insertAdjacentHTML("beforeend", field("name", "Name", draft.name) + `<div class="mb-3"><label class="form-label" for="field-mode">Type</label><select id="field-mode" name="mode" class="form-select"><option value="rsync">rsync copy</option><option value="snapshot">ZFS snapshot only</option></select></div>` + field("source", "Source directory", draft.source) + (draft.mode === "rsync" ? field("destination", "Destination directory", draft.destination) : ""));
  body.querySelector("#field-mode").value = draft.mode;
  for (const name of ["source", "destination"]) {
    const input = body.querySelector(`#field-${name}`);
    if (!input) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary mt-2";
    button.textContent = "Choose directory";
    button.onclick = () => openDirectoryPicker(input);
    input.parentElement.appendChild(button);
  }
}
function renderSchedule(body, draft) {
  body.insertAdjacentHTML("beforeend", `<div class="mb-3"><label class="form-label" for="field-schedule-kind">Frequency</label><select id="field-schedule-kind" name="scheduleKind" class="form-select"><option value="every-2">Every 2 hours</option><option value="every-6">Every 6 hours</option><option value="daily">Daily at 02:00</option><option value="custom">Custom systemd calendar</option></select></div>` + field("onCalendar", "Systemd OnCalendar", draft.onCalendar, "text", false) + `<div class="form-check"><input id="field-enabled" name="enabled" class="form-check-input" type="checkbox" ${draft.enabled ? "checked" : ""}><label class="form-check-label" for="field-enabled">Run automatically</label></div>`);
  body.querySelector("#field-schedule-kind").value = draft.scheduleKind;
}
async function renderSnapshots(body, draft) {
  const [source, destination] = await Promise.all([run("detect-zfs", [draft.source]).catch(() => ({ supported: false })), draft.mode === "rsync" ? run("detect-zfs", [draft.destination]).catch(() => ({ supported: false })) : Promise.resolve({ supported: false })]);
  if (draft.mode === "snapshot" && !source.supported) body.insertAdjacentHTML("beforeend", '<div class="alert alert-danger">The source must be on a ZFS dataset for snapshot-only backups.</div>');
  body.insertAdjacentHTML("beforeend", `<div class="form-check mb-2"><input id="field-snapshot-source" name="snapshotSource" class="form-check-input" type="checkbox" ${draft.snapshotSource || draft.mode === "snapshot" ? "checked" : ""} ${source.supported ? "" : "disabled"}><label class="form-check-label" for="field-snapshot-source">Snapshot source ${source.supported ? `(${escapeHtml(source.dataset)})` : "(not on ZFS)"}</label></div><div class="form-check mb-3"><input id="field-snapshot-destination" name="snapshotDestination" class="form-check-input" type="checkbox" ${draft.snapshotDestination ? "checked" : ""} ${destination.supported ? "" : "disabled"}><label class="form-check-label" for="field-snapshot-destination">Snapshot destination ${destination.supported ? `(${escapeHtml(destination.dataset)})` : "(not on ZFS)"}</label></div>` + field("snapshotRetention", "Snapshots to retain (0 keeps all)", draft.snapshotRetention, "number"));
}
async function renderReview(body, draft) {
  body.insertAdjacentHTML("beforeend", `<dl><dt>Type</dt><dd>${draft.mode === "snapshot" ? "ZFS snapshot" : "rsync copy"}</dd><dt>Source</dt><dd>${escapeHtml(draft.source)}</dd>${draft.mode === "rsync" ? `<dt>Destination</dt><dd>${escapeHtml(draft.destination)}</dd>` : ""}<dt>Schedule</dt><dd>${draft.enabled ? escapeHtml(draft.onCalendar) : "Paused"}</dd><dt>Retention</dt><dd>${draft.snapshotRetention || "Unlimited"}</dd></dl>`);
  if (draft.lastRun) body.insertAdjacentHTML("beforeend", `<h3 class="h6">Latest run</h3><p>${escapeHtml(lastRun(draft))} · ${escapeHtml(draft.lastRun.metrics?.files || "-")} files · ${escapeHtml(draft.lastRun.metrics?.transferred || "-")}</p>`);
  if (draft.lastRun) { const logs = document.createElement("pre"); logs.className = "log-output"; body.append(logs); const update = async () => { const [result, current] = await Promise.all([run("logs", [draft.id]).catch(() => ({ lines: [] })), run("list").then(({ jobs }) => jobs.find(job => job.id === draft.id)?.status).catch(() => null)]); logs.textContent = `${current?.running ? "Running" : current?.result || "Stopped"}\n\n${result.lines.join("\n") || "No logs."}`; }; await update(); detailTimer = setInterval(update, 3000); }
}
function readStep(body, draft, step) {
  const get = name => body.querySelector(`[name="${name}"]`);
  if (step === 0) { draft.name = get("name").value.trim(); draft.mode = get("mode").value; draft.source = get("source").value.trim(); draft.destination = draft.mode === "rsync" ? get("destination").value.trim() : null; if (!draft.name || !draft.source.startsWith("/") || (draft.mode === "rsync" && (!draft.destination.startsWith("/") || draft.destination === draft.source))) { alert("Informe nome e caminhos absolutos diferentes."); return false; } }
  if (step === 1) { draft.scheduleKind = get("scheduleKind").value; draft.onCalendar = { "every-2": "*-*-* 00/2:00:00", "every-6": "*-*-* 00/6:00:00", daily: "*-*-* 02:00:00" }[draft.scheduleKind] || get("onCalendar").value.trim(); draft.enabled = get("enabled").checked; if (draft.enabled && !draft.onCalendar) { alert("Informe uma agenda para ativar o backup."); return false; } }
  if (step === 2) { draft.snapshotSource = get("snapshotSource").checked; draft.snapshotDestination = get("snapshotDestination").checked; draft.snapshotRetention = Math.max(0, Number.parseInt(get("snapshotRetention").value, 10) || 0); if (draft.mode === "snapshot" && !draft.snapshotSource) { alert("Snapshot-only mode requires ZFS on the source."); return false; } }
  return true;
}
async function showLogs(id) {
  clearInterval(detailTimer); document.querySelector("#logs-title").textContent = "Backup logs"; logsModal.show();
  const update = async () => { try { const logs = await run("logs", [id]); document.querySelector("#backup-log").textContent = logs.lines.join("\n") || "Sem registros."; document.querySelector("#journal-log").textContent = logs.journal.join("\n") || "Sem registros."; } catch (error) { document.querySelector("#backup-log").textContent = error.message; } };
  await update(); detailTimer = setInterval(update, 3000);
}
async function browseDirectories(path) {
  const list = document.querySelector("#directory-list");
  list.replaceChildren();
  document.querySelector("#directory-path").textContent = "Loading...";
  try {
    const result = await run("directories", [path]);
    currentDirectory = result.path;
    document.querySelector("#directory-path").textContent = result.path;
    document.querySelector("#directory-up-button").disabled = result.path === "/";
    document.querySelector("#directory-up-button").onclick = () => browseDirectories(result.parent);
    for (const name of result.directories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "list-group-item list-group-item-action directory-item";
      button.textContent = name;
      button.onclick = () => browseDirectories(`${result.path === "/" ? "" : result.path}/${name}`);
      list.appendChild(button);
    }
    if (!result.directories.length) list.textContent = "No subdirectories available.";
  } catch (error) {
    document.querySelector("#directory-path").textContent = error.message;
    list.replaceChildren();
  }
}
async function openDirectoryPicker(input) {
  selectedDirectoryInput = input;
  directoryModal.show();
  await browseDirectories(input.value.startsWith("/") ? input.value : "/");
}
document.querySelector("#directory-select-button").addEventListener("click", () => {
  if (selectedDirectoryInput && currentDirectory) selectedDirectoryInput.value = currentDirectory;
  directoryModal.hide();
});
document.querySelector("#new-button").addEventListener("click", () => openWizard());
document.querySelector("#refresh-button").addEventListener("click", load);
document.querySelector("#import-navigator-button").addEventListener("click", async () => { if (!confirm("Import Cockpit Navigator schedules from root?")) return; try { const result = await run("import-navigator"); alert(result.imported ? `${result.imported} schedule(s) imported.` : "No new schedules were found.", "success"); await load(); } catch (error) { alert(error.message); } });
document.querySelector("#logs-modal").addEventListener("hidden.bs.modal", () => clearInterval(detailTimer));
document.querySelector("#job-modal").addEventListener("hidden.bs.modal", () => clearInterval(detailTimer));
jobsTable.addEventListener("click", async event => { const button = event.target.closest("button[data-action]"); if (!button) return; const job = JSON.parse(button.closest("tr").dataset.job); try { if (button.dataset.action === "edit") await openWizard(job); else if (button.dataset.action === "logs") await showLogs(job.id); else if (button.dataset.action === "run") { await run("start", [job.id]); alert(`Backup “${job.name}” started.`, "success"); await load(); } else if (button.dataset.action === "delete" && confirm(`Remove “${job.name}”, its timer, service, and logs?`)) { await run("delete", [job.id]); alert("Backup removed.", "success"); await load(); } } catch (error) { alert(error.message); } });
startPolling();
