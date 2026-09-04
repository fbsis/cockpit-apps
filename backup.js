const SCRIPT = "/usr/local/share/cockpit/cockpit-apps/scripts/backup.py3";
const jobsTable = document.querySelector("#jobs-table");
const jobModal = new bootstrap.Modal("#job-modal");
const logsModal = new bootstrap.Modal("#logs-modal");

function run(action, args = [], input) {
  return cockpit.spawn([SCRIPT, action, ...args], { superuser: "try", err: "message", input })
    .then(output => {
      const result = JSON.parse(output);
      if (!result.ok) throw new Error(result.error || "A operação de backup falhou.");
      return result;
    });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function alert(message, type = "danger") {
  const item = document.createElement("div");
  item.className = `alert alert-${type} alert-dismissible fade show`;
  item.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn-close";
  close.dataset.bsDismiss = "alert";
  item.append(close);
  document.querySelector("#alert-area").replaceChildren(item);
}

function statusLabel(job) {
  if (job.status?.running) return '<span class="badge text-bg-primary">Executando</span>';
  if (job.status?.result === "failed") return '<span class="badge text-bg-danger">Falhou</span>';
  return '<span class="badge text-bg-secondary">Parado</span>';
}

function lastRun(job) {
  if (!job.lastRun) return "Nunca executado";
  const result = job.lastRun.status === "success" ? "Concluído" : "Falhou";
  return `${result}: ${new Date(job.lastRun.at).toLocaleString()}`;
}

async function load() {
  document.querySelector("#refresh-button").disabled = true;
  try {
    const { jobs } = await run("list");
    jobsTable.replaceChildren();
    document.querySelector("#empty-state").hidden = jobs.length > 0;
    for (const job of jobs) {
      const row = document.createElement("tr");
      row.innerHTML = `<td class="fw-semibold">${escapeHtml(job.name)}</td><td>${escapeHtml(job.source)}</td><td>${escapeHtml(job.destination)}</td><td>${job.enabled ? escapeHtml(job.onCalendar) : "Pausado"}</td><td>${statusLabel(job)}</td><td>${escapeHtml(lastRun(job))}</td><td class="text-end job-actions"><button class="btn btn-sm btn-outline-primary" data-action="run" data-id="${job.id}">Executar</button> <button class="btn btn-sm btn-outline-secondary" data-action="logs" data-id="${job.id}">Logs</button> <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${job.id}">Editar</button> <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${job.id}">Remover</button></td>`;
      row.dataset.job = JSON.stringify(job);
      jobsTable.append(row);
    }
  } catch (error) { alert(error.message); }
  finally { document.querySelector("#refresh-button").disabled = false; }
}

function openForm(job = {}) {
  document.querySelector("#form-title").textContent = job.id ? "Editar backup" : "Novo backup";
  for (const [field, fallback] of Object.entries({ id: "", name: "", source: "", destination: "", onCalendar: "*-*-* 02:00:00", snapshotRetention: 14 })) document.querySelector(`#job-${field.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`).value = job[field] ?? fallback;
  document.querySelector("#job-enabled").checked = job.enabled ?? true;
  document.querySelector("#job-snapshot-source").checked = job.snapshotSource ?? false;
  document.querySelector("#job-snapshot-destination").checked = job.snapshotDestination ?? false;
  jobModal.show();
}

async function showLogs(id) {
  document.querySelector("#logs-title").textContent = "Logs do backup";
  document.querySelector("#backup-log").textContent = "Carregando...";
  document.querySelector("#journal-log").textContent = "Carregando...";
  logsModal.show();
  try {
    const logs = await run("logs", [id]);
    document.querySelector("#backup-log").textContent = logs.lines.join("\n") || "Sem registros.";
    document.querySelector("#journal-log").textContent = logs.journal.join("\n") || "Sem registros.";
  } catch (error) { document.querySelector("#backup-log").textContent = error.message; document.querySelector("#journal-log").textContent = ""; }
}

document.querySelector("#new-button").addEventListener("click", () => openForm());
document.querySelector("#refresh-button").addEventListener("click", load);
jobsTable.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const job = JSON.parse(button.closest("tr").dataset.job);
  try {
    if (button.dataset.action === "edit") openForm(job);
    else if (button.dataset.action === "logs") await showLogs(job.id);
    else if (button.dataset.action === "run") { await run("start", [job.id]); alert(`Backup “${job.name}” iniciado.`, "success"); await load(); }
    else if (button.dataset.action === "delete" && confirm(`Remover o backup “${job.name}”?`)) { await run("delete", [job.id]); alert("Backup removido.", "success"); await load(); }
  } catch (error) { alert(error.message); }
});
document.querySelector("#job-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const job = Object.fromEntries(form);
  job.id ||= crypto.randomUUID();
  job.enabled = form.has("enabled");
  job.snapshotSource = form.has("snapshotSource");
  job.snapshotDestination = form.has("snapshotDestination");
  job.snapshotRetention = Number(job.snapshotRetention);
  const button = document.querySelector("#save-button");
  button.disabled = true;
  try { await run("save", [], JSON.stringify(job)); jobModal.hide(); alert("Backup salvo e agendamento atualizado.", "success"); await load(); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});
load();
