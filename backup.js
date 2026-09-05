const SCRIPT = "/usr/local/share/cockpit/cockpit-apps/scripts/backup.py3";
const jobsTable = document.querySelector("#jobs-table");
const jobModal = new bootstrap.Modal("#job-modal");
const logsModal = new bootstrap.Modal("#logs-modal");
const directoryModal = new bootstrap.Modal("#directory-modal");
let refreshTimer;
let detailTimer;
let selectedDirectoryInput;
let currentDirectory;

function run(action, args = [], input) {
  const process = cockpit.spawn([SCRIPT, action, ...args], { err: "message", input });
  let timeoutId;
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => { process.close("timeout"); reject(new Error("A operação excedeu 30 segundos. Verifique o systemd do root.")); }, 30000); });
  return Promise.race([process, timeout]).then(output => {
    const result = JSON.parse(output);
    if (!result.ok) throw new Error(result.error || "A operação de backup falhou.");
    return result;
  }).finally(() => clearTimeout(timeoutId));
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function alert(message, type = "danger") {
  const item = document.createElement("div"); item.className = `alert alert-${type} alert-dismissible fade show`; item.textContent = message;
  const close = document.createElement("button"); close.type = "button"; close.className = "btn-close"; close.dataset.bsDismiss = "alert"; item.append(close);
  document.querySelector("#alert-area").replaceChildren(item);
}
function statusLabel(job) {
  if (job.status?.running) return '<span class="badge text-bg-primary">Executando</span>';
  if (job.status?.result === "failed") return '<span class="badge text-bg-danger">Falhou</span>';
  return '<span class="badge text-bg-secondary">Parado</span>';
}
function lastRun(job) {
  if (!job.lastRun) return "Nunca executado";
  return `${job.lastRun.status === "success" ? "Concluído" : "Falhou"}: ${new Date(job.lastRun.at).toLocaleString()}`;
}
function renderSummary(jobs) {
  const latest = jobs.filter(job => job.lastRun?.at).sort((a, b) => new Date(b.lastRun.at) - new Date(a.lastRun.at))[0];
  document.querySelector("#total-count").textContent = jobs.length;
  document.querySelector("#enabled-count").textContent = jobs.filter(job => job.enabled).length;
  document.querySelector("#running-count").textContent = jobs.filter(job => job.status?.running).length;
  document.querySelector("#last-result").textContent = latest ? lastRun(latest) : "Nenhuma execução";
}
async function load() {
  try {
    const { jobs } = await run("list"); renderSummary(jobs); jobsTable.replaceChildren(); document.querySelector("#empty-state").hidden = jobs.length > 0;
    for (const job of jobs) {
      const row = document.createElement("tr");
      row.innerHTML = `<td class="fw-semibold">${escapeHtml(job.name)}</td><td>${job.mode === "snapshot" ? "Snapshot ZFS" : escapeHtml(job.source)}</td><td>${job.mode === "snapshot" ? "—" : escapeHtml(job.destination)}</td><td>${job.enabled ? escapeHtml(job.onCalendar || "") : "Pausado"}</td><td>${statusLabel(job)}</td><td>${escapeHtml(lastRun(job))}</td><td class="text-end job-actions"><button class="btn btn-sm btn-outline-primary" data-action="run">Executar</button> <button class="btn btn-sm btn-outline-secondary" data-action="edit">Editar</button> <button class="btn btn-sm btn-outline-secondary" data-action="logs">Logs</button> <button class="btn btn-sm btn-outline-danger" data-action="delete">Remover</button></td>`;
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
  document.querySelector("#form-title").textContent = job ? `Editar backup: ${job.name}` : "Novo backup";
  const form = document.querySelector("#job-form");
  const body = document.querySelector("#form-fields");
  const footer = form.querySelector(".modal-footer");
  async function render() {
    clearInterval(detailTimer); body.replaceChildren(); footer.replaceChildren();
    const progress = document.createElement("p"); progress.className = "text-body-secondary small"; progress.textContent = `Etapa ${step + 1} de 4`; body.append(progress);
    if (step === 0) renderPaths(body, draft);
    if (step === 1) renderSchedule(body, draft);
    if (step === 2) await renderSnapshots(body, draft);
    if (step === 3) await renderReview(body, draft);
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn btn-secondary"; cancel.textContent = "Cancelar"; cancel.onclick = () => jobModal.hide(); footer.append(cancel);
    if (step) { const back = document.createElement("button"); back.type = "button"; back.className = "btn btn-outline-secondary"; back.textContent = "Voltar"; back.onclick = async () => { if (readStep(body, draft, step)) { step--; await render(); } }; footer.append(back); }
    const next = document.createElement("button"); next.type = "button"; next.className = "btn btn-primary"; next.textContent = step === 3 ? "Salvar agendamento" : "Avançar";
    next.addEventListener("click", async () => {
      if (!readStep(body, draft, step)) return;
      if (step < 3) { step++; await render(); return; }
      next.disabled = true;
      next.textContent = "Salvando...";
      try {
        await run("save", [], JSON.stringify(draft));
        clearInterval(detailTimer);
        jobModal.hide();
        alert("Backup salvo e timer atualizado.", "success");
        await load();
      } catch (error) {
        alert(error.message || "O agendamento não pôde ser salvo.");
        next.disabled = false;
        next.textContent = "Salvar agendamento";
      }
    });
    footer.append(next);
  }
  form.onsubmit = event => { event.preventDefault(); };
  await render(); jobModal.show();
}
function renderPaths(body, draft) {
  body.insertAdjacentHTML("beforeend", field("name", "Nome", draft.name) + `<div class="mb-3"><label class="form-label" for="field-mode">Tipo</label><select id="field-mode" name="mode" class="form-select"><option value="rsync">Cópia rsync</option><option value="snapshot">Somente snapshot ZFS</option></select></div>` + field("source", "Diretório de origem", draft.source) + (draft.mode === "rsync" ? field("destination", "Diretório de destino", draft.destination) : ""));
  body.querySelector("#field-mode").value = draft.mode;
  for (const name of ["source", "destination"]) {
    const input = body.querySelector(`#field-${name}`);
    if (!input) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary mt-2";
    button.textContent = "Escolher pasta";
    button.onclick = () => openDirectoryPicker(input);
    input.parentElement.appendChild(button);
  }
}
function renderSchedule(body, draft) {
  body.insertAdjacentHTML("beforeend", `<div class="mb-3"><label class="form-label" for="field-schedule-kind">Frequência</label><select id="field-schedule-kind" name="scheduleKind" class="form-select"><option value="every-2">A cada 2 horas</option><option value="every-6">A cada 6 horas</option><option value="daily">Diariamente às 02:00</option><option value="custom">Calendário systemd personalizado</option></select></div>` + field("onCalendar", "Systemd OnCalendar", draft.onCalendar, "text", false) + `<div class="form-check"><input id="field-enabled" name="enabled" class="form-check-input" type="checkbox" ${draft.enabled ? "checked" : ""}><label class="form-check-label" for="field-enabled">Executar automaticamente</label></div>`);
  body.querySelector("#field-schedule-kind").value = draft.scheduleKind;
}
async function renderSnapshots(body, draft) {
  const [source, destination] = await Promise.all([run("detect-zfs", [draft.source]).catch(() => ({ supported: false })), draft.mode === "rsync" ? run("detect-zfs", [draft.destination]).catch(() => ({ supported: false })) : Promise.resolve({ supported: false })]);
  if (draft.mode === "snapshot" && !source.supported) body.insertAdjacentHTML("beforeend", '<div class="alert alert-danger">A origem precisa estar em um dataset ZFS para snapshots sem rsync.</div>');
  body.insertAdjacentHTML("beforeend", `<div class="form-check mb-2"><input id="field-snapshot-source" name="snapshotSource" class="form-check-input" type="checkbox" ${draft.snapshotSource || draft.mode === "snapshot" ? "checked" : ""} ${source.supported ? "" : "disabled"}><label class="form-check-label" for="field-snapshot-source">Snapshot da origem ${source.supported ? `(${escapeHtml(source.dataset)})` : "(não está em ZFS)"}</label></div><div class="form-check mb-3"><input id="field-snapshot-destination" name="snapshotDestination" class="form-check-input" type="checkbox" ${draft.snapshotDestination ? "checked" : ""} ${destination.supported ? "" : "disabled"}><label class="form-check-label" for="field-snapshot-destination">Snapshot do destino ${destination.supported ? `(${escapeHtml(destination.dataset)})` : "(não está em ZFS)"}</label></div>` + field("snapshotRetention", "Snapshots mantidos (0 mantém todos)", draft.snapshotRetention, "number"));
}
async function renderReview(body, draft) {
  body.insertAdjacentHTML("beforeend", `<dl><dt>Tipo</dt><dd>${draft.mode === "snapshot" ? "Snapshot ZFS" : "Cópia rsync"}</dd><dt>Origem</dt><dd>${escapeHtml(draft.source)}</dd>${draft.mode === "rsync" ? `<dt>Destino</dt><dd>${escapeHtml(draft.destination)}</dd>` : ""}<dt>Agenda</dt><dd>${draft.enabled ? escapeHtml(draft.onCalendar) : "Pausado"}</dd><dt>Retenção</dt><dd>${draft.snapshotRetention || "Ilimitada"}</dd></dl>`);
  if (draft.lastRun) body.insertAdjacentHTML("beforeend", `<h3 class="h6">Última execução</h3><p>${escapeHtml(lastRun(draft))} · ${escapeHtml(draft.lastRun.metrics?.files || "—")} arquivos · ${escapeHtml(draft.lastRun.metrics?.transferred || "—")}</p>`);
  if (draft.id) { const logs = document.createElement("pre"); logs.className = "log-output"; body.append(logs); const update = async () => { const [result, current] = await Promise.all([run("logs", [draft.id]).catch(() => ({ lines: [] })), run("list").then(({ jobs }) => jobs.find(job => job.id === draft.id)?.status).catch(() => null)]); logs.textContent = `${current?.running ? "Executando" : current?.result || "Parado"}\n\n${result.lines.join("\n") || "Sem logs."}`; }; await update(); detailTimer = setInterval(update, 3000); }
}
function readStep(body, draft, step) {
  const get = name => body.querySelector(`[name="${name}"]`);
  if (step === 0) { draft.name = get("name").value.trim(); draft.mode = get("mode").value; draft.source = get("source").value.trim(); draft.destination = draft.mode === "rsync" ? get("destination").value.trim() : null; if (!draft.name || !draft.source.startsWith("/") || (draft.mode === "rsync" && (!draft.destination.startsWith("/") || draft.destination === draft.source))) { alert("Informe nome e caminhos absolutos diferentes."); return false; } }
  if (step === 1) { draft.scheduleKind = get("scheduleKind").value; draft.onCalendar = { "every-2": "*-*-* 00/2:00:00", "every-6": "*-*-* 00/6:00:00", daily: "*-*-* 02:00:00" }[draft.scheduleKind] || get("onCalendar").value.trim(); draft.enabled = get("enabled").checked; if (draft.enabled && !draft.onCalendar) { alert("Informe uma agenda para ativar o backup."); return false; } }
  if (step === 2) { draft.snapshotSource = get("snapshotSource").checked; draft.snapshotDestination = get("snapshotDestination").checked; draft.snapshotRetention = Math.max(0, Number.parseInt(get("snapshotRetention").value, 10) || 0); if (draft.mode === "snapshot" && !draft.snapshotSource) { alert("O modo snapshot exige ZFS na origem."); return false; } }
  return true;
}
async function showLogs(id) {
  clearInterval(detailTimer); document.querySelector("#logs-title").textContent = "Logs do backup"; logsModal.show();
  const update = async () => { try { const logs = await run("logs", [id]); document.querySelector("#backup-log").textContent = logs.lines.join("\n") || "Sem registros."; document.querySelector("#journal-log").textContent = logs.journal.join("\n") || "Sem registros."; } catch (error) { document.querySelector("#backup-log").textContent = error.message; } };
  await update(); detailTimer = setInterval(update, 3000);
}
async function browseDirectories(path) {
  const list = document.querySelector("#directory-list");
  list.replaceChildren();
  document.querySelector("#directory-path").textContent = "Carregando...";
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
    if (!result.directories.length) list.textContent = "Nenhuma subpasta disponível.";
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
document.querySelector("#import-navigator-button").addEventListener("click", async () => { if (!confirm("Importar os agendamentos do Cockpit Navigator do root?")) return; try { const result = await run("import-navigator"); alert(result.imported ? `${result.imported} agendamento(s) importado(s).` : "Nenhum agendamento novo foi encontrado.", "success"); await load(); } catch (error) { alert(error.message); } });
document.querySelector("#logs-modal").addEventListener("hidden.bs.modal", () => clearInterval(detailTimer));
document.querySelector("#job-modal").addEventListener("hidden.bs.modal", () => clearInterval(detailTimer));
jobsTable.addEventListener("click", async event => { const button = event.target.closest("button[data-action]"); if (!button) return; const job = JSON.parse(button.closest("tr").dataset.job); try { if (button.dataset.action === "edit") await openWizard(job); else if (button.dataset.action === "logs") await showLogs(job.id); else if (button.dataset.action === "run") { await run("start", [job.id]); alert(`Backup “${job.name}” iniciado.`, "success"); await load(); } else if (button.dataset.action === "delete" && confirm(`Remover “${job.name}”, timer, serviço e logs?`)) { await run("delete", [job.id]); alert("Backup removido.", "success"); await load(); } } catch (error) { alert(error.message); } });
startPolling();
