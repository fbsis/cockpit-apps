"use strict";

const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;
const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/i;
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const CONTAINER_ACTIONS = new Set(["start", "stop", "restart"]);

let containers = [];
let images = [];
let volumes = [];
let networks = [];
let activeLogProcess = null;
let pendingAction = null;
let formMode = null;
let formContext = null;
let logsModal;
let formModal;
let detailsModal;
let confirmModal;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function command(args, options = {}) {
  return cockpit.spawn(args, { superuser: "try", err: "message", ...options });
}

function parseJsonLines(output) {
  return output.split("\n").map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
}

function normalizeContainer(item) {
  return { id: item.ID, name: item.Names || item.ID.slice(0, 12), image: item.Image || "—", state: (item.State || "unknown").toLowerCase(), status: item.Status || "—", ports: item.Ports || "—" };
}

function normalizeImage(item, index) {
  const repository = item.Repository || "<none>";
  const tag = item.Tag || "<none>";
  return { id: item.ID, key: `${item.ID}|${repository}:${tag}|${index}`, repository, tag, digest: item.Digest || "—", created: item.CreatedSince || item.CreatedAt || "—", size: item.Size || "—" };
}

function normalizeVolume(item) {
  return { name: item.Name, driver: item.Driver || "local", scope: item.Scope || "local", mountpoint: item.Mountpoint || "—", labels: item.Labels || "" };
}

function normalizeNetwork(item) {
  return { id: item.ID, name: item.Name, driver: item.Driver || "—", scope: item.Scope || "local", internal: String(item.Internal).toLowerCase() === "true", ipv6: String(item.IPv6).toLowerCase() === "true" };
}

function isRunning(container) {
  return container.state === "running";
}

function showAlert(message, type = "danger") {
  const wrapper = document.createElement("div");
  wrapper.className = `alert alert-${type} alert-dismissible fade show`;
  wrapper.setAttribute("role", "alert");
  wrapper.append(document.createTextNode(message));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn-close";
  close.dataset.bsDismiss = "alert";
  close.setAttribute("aria-label", "Fechar");
  wrapper.append(close);
  document.querySelector("#alert-area").replaceChildren(wrapper);
}

function setLoading(loading) {
  const button = document.querySelector("#refresh-button");
  button.disabled = loading;
  button.querySelector("i").classList.toggle("spin", loading);
}

function renderAll() {
  const filter = document.querySelector("#state-filter").value;
  const filtered = filter === "running" ? containers.filter(isRunning) : filter === "stopped" ? containers.filter(item => !isRunning(item)) : containers;
  $("#containers-table").bootstrapTable("load", filtered);
  $("#images-table").bootstrapTable("load", images);
  $("#volumes-table").bootstrapTable("load", volumes);
  $("#networks-table").bootstrapTable("load", networks);

  const running = containers.filter(isRunning).length;
  document.querySelector("#total-count").textContent = containers.length;
  document.querySelector("#running-count").textContent = running;
  document.querySelector("#stopped-count").textContent = containers.length - running;
  for (const [name, count] of [["containers", containers.length], ["images", images.length], ["volumes", volumes.length], ["networks", networks.length]]) {
    document.querySelector(`#${name}-badge`).textContent = count;
  }
}

async function loadAll() {
  setLoading(true);
  try {
    const [containerOutput, imageOutput, volumeOutput, networkOutput, versionOutput] = await Promise.all([
      command(["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "image", "ls", "-a", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "volume", "ls", "--format", "{{json .}}"]),
      command(["docker", "network", "ls", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "version", "--format", "{{.Server.Version}}"]),
    ]);
    containers = parseJsonLines(containerOutput).map(normalizeContainer);
    images = parseJsonLines(imageOutput).map(normalizeImage);
    volumes = parseJsonLines(volumeOutput).map(normalizeVolume);
    networks = parseJsonLines(networkOutput).map(normalizeNetwork);
    renderAll();
    document.querySelector("#docker-version").textContent = `v${versionOutput.trim()}`;
    const status = document.querySelector("#docker-status");
    status.className = "badge text-bg-success";
    status.textContent = "Docker conectado";
  } catch (error) {
    const status = document.querySelector("#docker-status");
    status.className = "badge text-bg-danger";
    status.textContent = "Docker indisponível";
    showAlert(error.message || "Não foi possível consultar o Docker.");
  } finally {
    setLoading(false);
  }
}

window.nameFormatter = (value, row) => `<div class="fw-semibold">${escapeHtml(value)}</div><div class="resource-id text-body-secondary">${escapeHtml(row.id.slice(0, 12))}</div>`;
window.imageNameFormatter = (value, row) => `<div class="fw-semibold">${escapeHtml(value)}</div><div class="resource-id text-body-secondary">${escapeHtml(row.id.replace("sha256:", "").slice(0, 12))}</div>`;
window.stateFormatter = value => {
  const states = { running: ["success", "Em execução"], exited: ["secondary", "Parado"], created: ["info", "Criado"], paused: ["warning", "Pausado"], restarting: ["warning", "Reiniciando"], dead: ["danger", "Com falha"] };
  const [style, label] = states[value] || ["secondary", value || "Desconhecido"];
  return `<span class="badge text-bg-${style}">${escapeHtml(label)}</span>`;
};
window.portsFormatter = value => `<div class="ports-list">${String(value || "—").split(",").map(port => escapeHtml(port.trim())).join("<br>")}</div>`;
window.booleanFormatter = value => value ? '<span class="badge text-bg-success">Sim</span>' : '<span class="badge text-bg-secondary">Não</span>';

function actionButton(action, id, icon, label, style = "outline-secondary", disabled = false) {
  return `<button type="button" class="btn btn-${style}" data-resource-action="${action}" data-resource-id="${escapeHtml(id)}" title="${escapeHtml(label)}" ${disabled ? "disabled" : ""}><i class="bi bi-${icon}" aria-hidden="true"></i><span class="visually-hidden">${escapeHtml(label)}</span></button>`;
}

window.containerActionsFormatter = (_value, row) => {
  const running = isRunning(row);
  return `<div class="btn-group btn-group-sm actions-group">${actionButton("container-inspect", row.id, "info-circle", "Detalhes", "outline-primary")}${actionButton("logs", row.id, "terminal", "Logs", "outline-primary")}${running ? actionButton("restart", row.id, "arrow-repeat", "Reiniciar") : ""}${actionButton(running ? "stop" : "start", row.id, running ? "stop-fill" : "play-fill", running ? "Parar" : "Iniciar", running ? "outline-danger" : "outline-success")}</div>`;
};
window.imageActionsFormatter = (_value, row) => `<div class="btn-group btn-group-sm actions-group">${actionButton("image-inspect", row.key, "info-circle", "Detalhes", "outline-primary")}${actionButton("image-tag", row.key, "tag", "Adicionar tag")}${actionButton("image-remove", row.key, "trash", "Apagar", "outline-danger")}</div>`;
window.volumeActionsFormatter = (_value, row) => `<div class="btn-group btn-group-sm actions-group">${actionButton("volume-inspect", row.name, "info-circle", "Detalhes", "outline-primary")}${actionButton("volume-remove", row.name, "trash", "Apagar", "outline-danger")}</div>`;
window.networkActionsFormatter = (_value, row) => {
  const system = ["bridge", "host", "none"].includes(row.name);
  return `<div class="btn-group btn-group-sm actions-group">${actionButton("network-inspect", row.id, "info-circle", "Detalhes", "outline-primary")}${actionButton("network-manage", row.id, "diagram-3", "Editar conexões")}${actionButton("network-remove", row.id, "trash", "Apagar", "outline-danger", system)}</div>`;
};

function imageReference(image) {
  return image.repository !== "<none>" && image.tag !== "<none>" ? `${image.repository}:${image.tag}` : image.id;
}

function requestConfirm(title, message, task) {
  pendingAction = task;
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  confirmModal.show();
}

async function runConfirmedAction() {
  if (!pendingAction) return;
  const task = pendingAction;
  pendingAction = null;
  const button = document.querySelector("#confirm-action-button");
  button.disabled = true;
  try {
    await task();
    confirmModal.hide();
    showAlert("Operação concluída com sucesso.", "success");
    await loadAll();
  } catch (error) {
    confirmModal.hide();
    showAlert(error.message || "Não foi possível concluir a operação.");
  } finally {
    button.disabled = false;
  }
}

async function inspectResource(kind, id, title) {
  if (!id) return;
  document.querySelector("#details-title").textContent = title;
  document.querySelector("#details-output").textContent = "Carregando...";
  detailsModal.show();
  try {
    const output = await command(["docker", kind, "inspect", id]);
    document.querySelector("#details-output").textContent = JSON.stringify(JSON.parse(output), null, 2);
  } catch (error) {
    document.querySelector("#details-output").textContent = error.message || "Não foi possível carregar os detalhes.";
  }
}

function stopLogStream() {
  if (activeLogProcess) {
    activeLogProcess.close("cancelled");
    activeLogProcess = null;
  }
}

function openLogs(container) {
  stopLogStream();
  const output = document.querySelector("#logs-output");
  const status = document.querySelector("#logs-status");
  document.querySelector("#logs-title").textContent = `Logs — ${container.name}`;
  output.textContent = "";
  status.textContent = "Acompanhando em tempo real";
  logsModal.show();
  const process = command(["docker", "logs", "--follow", "--tail", "200", "--timestamps", container.id], { err: "out", batch: 4096, latency: 200 });
  activeLogProcess = process;
  process.stream(data => {
    const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 80;
    output.textContent += data;
    if (follow) output.scrollTop = output.scrollHeight;
  });
  process.then(() => { if (activeLogProcess === process) activeLogProcess = null; status.textContent = "Fluxo encerrado"; }).catch(error => { if (activeLogProcess === process) activeLogProcess = null; if (error.problem !== "cancelled") status.textContent = error.message || "Falha nos logs"; });
}

function field(name, label, value = "", help = "", type = "text", required = true) {
  return `<div class="mb-3"><label class="form-label" for="field-${name}">${escapeHtml(label)}</label><input class="form-control" id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}>${help ? `<div class="form-text">${escapeHtml(help)}</div>` : ""}</div>`;
}

function openForm(mode, context = null) {
  formMode = mode;
  formContext = context;
  let title;
  let fields;
  if (mode === "image-pull") {
    title = "Baixar imagem";
    fields = field("reference", "Imagem", "", "Exemplo: nginx:latest ou registry.exemplo.com/app:1.0");
  } else if (mode === "image-tag") {
    title = "Adicionar tag à imagem";
    fields = field("target", "Nova referência", "", "Exemplo: minha-app:producao");
  } else if (mode === "volume-create") {
    title = "Criar volume";
    fields = field("name", "Nome") + field("driver", "Driver", "local") + '<div class="mb-3"><label class="form-label" for="field-labels">Labels</label><textarea class="form-control" id="field-labels" name="labels" rows="3" placeholder="ambiente=producao&#10;app=cockpit"></textarea><div class="form-text">Uma label por linha, no formato chave=valor.</div></div>';
  } else if (mode === "network-create") {
    title = "Criar rede";
    fields = field("name", "Nome") + field("driver", "Driver", "bridge") + field("subnet", "Subnet", "", "Opcional. Exemplo: 172.30.0.0/16", "text", false) + field("gateway", "Gateway", "", "Opcional. Exemplo: 172.30.0.1", "text", false) + '<div class="form-check"><input class="form-check-input" type="checkbox" id="field-internal" name="internal"><label class="form-check-label" for="field-internal">Rede interna, sem acesso externo</label></div>';
  } else if (mode === "network-manage") {
    title = `Editar conexões — ${context.name}`;
    const options = containers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
    fields = `<div class="mb-3"><label class="form-label" for="field-operation">Operação</label><select class="form-select" id="field-operation" name="operation"><option value="connect">Conectar</option><option value="disconnect">Desconectar</option></select></div><div class="mb-3"><label class="form-label" for="field-container">Container</label><select class="form-select" id="field-container" name="container" required>${options}</select></div>`;
  } else return;
  document.querySelector("#form-title").textContent = title;
  document.querySelector("#form-fields").innerHTML = fields;
  formModal.show();
}

function validArgument(value) {
  return value && value.length <= 255 && !value.startsWith("-") && !/\s/.test(value);
}

async function submitResourceForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const button = document.querySelector("#save-resource-button");
  let args;
  if (formMode === "image-pull") {
    const reference = data.get("reference").trim();
    if (!validArgument(reference)) return showAlert("Informe uma referência de imagem válida.");
    args = ["docker", "image", "pull", reference];
  } else if (formMode === "image-tag") {
    const target = data.get("target").trim();
    if (!validArgument(target)) return showAlert("Informe uma tag válida.");
    args = ["docker", "image", "tag", imageReference(formContext), target];
  } else if (formMode === "volume-create") {
    const name = data.get("name").trim();
    const driver = data.get("driver").trim();
    if (!RESOURCE_NAME.test(name) || !RESOURCE_NAME.test(driver)) return showAlert("Nome ou driver inválido.");
    args = ["docker", "volume", "create", "--driver", driver];
    for (const label of data.get("labels").split("\n").map(item => item.trim()).filter(Boolean)) {
      if (!/^[a-zA-Z0-9_.-]+=.*/.test(label)) return showAlert(`Label inválida: ${label}`);
      args.push("--label", label);
    }
    args.push(name);
  } else if (formMode === "network-create") {
    const name = data.get("name").trim();
    const driver = data.get("driver").trim();
    if (!RESOURCE_NAME.test(name) || !RESOURCE_NAME.test(driver)) return showAlert("Nome ou driver inválido.");
    args = ["docker", "network", "create", "--driver", driver];
    for (const option of ["subnet", "gateway"]) {
      const value = data.get(option).trim();
      if (value) {
        if (!validArgument(value)) return showAlert(`${option} inválido.`);
        args.push(`--${option}`, value);
      }
    }
    if (data.get("internal")) args.push("--internal");
    args.push(name);
  } else if (formMode === "network-manage") {
    const operation = data.get("operation");
    const containerId = data.get("container");
    if (!["connect", "disconnect"].includes(operation) || !CONTAINER_ID.test(containerId)) return showAlert("Operação inválida.");
    args = ["docker", "network", operation, formContext.id, containerId];
  } else return;

  button.disabled = true;
  try {
    await command(args);
    formModal.hide();
    showAlert("Operação concluída com sucesso.", "success");
    await loadAll();
  } catch (error) {
    showAlert(error.message || "Não foi possível salvar o recurso.");
  } finally {
    button.disabled = false;
  }
}

function handleResourceAction(event) {
  const create = event.target.closest("[data-create]");
  if (create) return openForm(`${create.dataset.create}-${create.dataset.create === "image" ? "pull" : "create"}`);
  const button = event.target.closest("[data-resource-action]");
  if (!button) return;
  const action = button.dataset.resourceAction;
  const id = button.dataset.resourceId;
  const container = containers.find(item => item.id === id);
  const image = images.find(item => item.key === id);
  const volume = volumes.find(item => item.name === id);
  const network = networks.find(item => item.id === id);

  if (action === "logs" && container) return openLogs(container);
  if (CONTAINER_ACTIONS.has(action) && container) return requestConfirm(`${action} container`, `Deseja executar “${action}” em “${container.name}”?`, () => command(["docker", action, container.id]));
  if (action === "container-inspect" && container) return inspectResource("container", container.id, `Container — ${container.name}`);
  if (action === "image-inspect" && image) return inspectResource("image", image.id, `Imagem — ${imageReference(image)}`);
  if (action === "image-tag" && image) return openForm("image-tag", image);
  if (action === "image-remove" && image) return requestConfirm("Apagar imagem", `Deseja apagar “${imageReference(image)}”? Containers dependentes podem impedir a operação.`, () => command(["docker", "image", "rm", imageReference(image)]));
  if (action === "volume-inspect" && volume) return inspectResource("volume", volume.name, `Volume — ${volume.name}`);
  if (action === "volume-remove" && volume) return requestConfirm("Apagar volume", `Deseja apagar “${volume.name}”? Os dados serão perdidos e a operação não pode ser desfeita.`, () => command(["docker", "volume", "rm", volume.name]));
  if (action === "network-inspect" && network) return inspectResource("network", network.id, `Rede — ${network.name}`);
  if (action === "network-manage" && network) return openForm("network-manage", network);
  if (action === "network-remove" && network) return requestConfirm("Apagar rede", `Deseja apagar “${network.name}”? A rede precisa estar sem containers conectados.`, () => command(["docker", "network", "rm", network.id]));
  showAlert("Recurso inválido ou não encontrado.");
}

document.addEventListener("DOMContentLoaded", () => {
  logsModal = new bootstrap.Modal("#logs-modal");
  formModal = new bootstrap.Modal("#form-modal");
  detailsModal = new bootstrap.Modal("#details-modal");
  confirmModal = new bootstrap.Modal("#confirm-modal");
  for (const id of ["containers-table", "images-table", "volumes-table", "networks-table"]) $(`#${id}`).bootstrapTable();
  document.addEventListener("click", handleResourceAction);
  document.querySelector("#refresh-button").addEventListener("click", loadAll);
  document.querySelector("#state-filter").addEventListener("change", renderAll);
  document.querySelector("#confirm-action-button").addEventListener("click", runConfirmedAction);
  document.querySelector("#resource-form").addEventListener("submit", submitResourceForm);
  document.querySelector("#clear-logs-button").addEventListener("click", () => { document.querySelector("#logs-output").textContent = ""; });
  document.querySelector("#logs-modal").addEventListener("hidden.bs.modal", stopLogStream);
  document.querySelector("#confirm-modal").addEventListener("hidden.bs.modal", () => { pendingAction = null; });
  loadAll();
});
