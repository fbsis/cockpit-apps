import { command, inspect } from "./docker.js";

let pendingAction = null;
let activeLogProcess = null;
let refreshCallback = async () => {};

export const modals = {};

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function actionButton(action, id, icon, label, style = "outline-secondary", disabled = false) {
  return `<button type="button" class="btn btn-${style}" data-resource-action="${action}" data-resource-id="${escapeHtml(id)}" title="${escapeHtml(label)}" ${disabled ? "disabled" : ""}><i class="bi bi-${icon}" aria-hidden="true"></i><span class="visually-hidden">${escapeHtml(label)}</span></button>`;
}

export function field(name, label, value = "", help = "", required = true) {
  return `<div class="mb-3"><label class="form-label" for="field-${name}">${escapeHtml(label)}</label><input class="form-control" id="field-${name}" name="${name}" value="${escapeHtml(value)}" ${required ? "required" : ""}>${help ? `<div class="form-text">${escapeHtml(help)}</div>` : ""}</div>`;
}

export function showAlert(message, type = "danger") {
  const wrapper = document.createElement("div");
  wrapper.className = `alert alert-${type} alert-dismissible fade show`;
  wrapper.setAttribute("role", "alert");
  wrapper.append(document.createTextNode(message));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn-close";
  close.dataset.bsDismiss = "alert";
  close.setAttribute("aria-label", "Close");
  wrapper.append(close);
  document.querySelector("#alert-area").replaceChildren(wrapper);
}

export function setLoading(loading) {
  const button = document.querySelector("#refresh-button");
  button.disabled = loading;
  button.querySelector("i").classList.toggle("spin", loading);
}

export function initializeUi(onRefresh) {
  refreshCallback = onRefresh;
  modals.logs = new bootstrap.Modal("#logs-modal");
  modals.form = new bootstrap.Modal("#form-modal");
  modals.details = new bootstrap.Modal("#details-modal");
  modals.confirm = new bootstrap.Modal("#confirm-modal");
  document.querySelector("#confirm-action-button").addEventListener("click", runConfirmedAction);
  document.querySelector("#clear-logs-button").addEventListener("click", () => { document.querySelector("#logs-output").textContent = ""; });
  document.querySelector("#logs-modal").addEventListener("hidden.bs.modal", stopLogs);
  document.querySelector("#confirm-modal").addEventListener("hidden.bs.modal", () => { pendingAction = null; });
}

export function confirmAction(title, message, task) {
  pendingAction = task;
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  modals.confirm.show();
}

export function confirmActionWithOptions(title, message, options, task) {
  pendingAction = () => task(options.filter(option => document.querySelector(`#${option.id}`)?.checked).map(option => option.value));
  document.querySelector("#confirm-title").textContent = title;
  const content = document.querySelector("#confirm-message");
  const description = document.createElement("p");
  description.textContent = message;
  content.replaceChildren(description);
  for (const option of options) {
    const field = document.createElement("div");
    field.className = "form-check";
    const input = document.createElement("input");
    input.id = option.id;
    input.className = "form-check-input";
    input.type = "checkbox";
    input.disabled = option.disabled;
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.htmlFor = option.id;
    label.textContent = option.label;
    field.append(input, label);
    content.appendChild(field);
  }
  modals.confirm.show();
}

async function runConfirmedAction() {
  if (!pendingAction) return;
  const task = pendingAction;
  pendingAction = null;
  const button = document.querySelector("#confirm-action-button");
  button.disabled = true;
  try {
    await task();
    modals.confirm.hide();
    showAlert("Operation completed successfully.", "success");
    await refreshCallback();
  } catch (error) {
    modals.confirm.hide();
    showAlert(error.message || "The operation could not be completed.");
  } finally {
    button.disabled = false;
  }
}

export async function showDetails(kind, id, title) {
  document.querySelector("#details-title").textContent = title;
  document.querySelector("#details-output").textContent = "Loading...";
  modals.details.show();
  try {
    document.querySelector("#details-output").textContent = await inspect(kind, id);
  } catch (error) {
    document.querySelector("#details-output").textContent = error.message || "Details could not be loaded.";
  }
}

export function openLogs(container) {
  stopLogs();
  const output = document.querySelector("#logs-output");
  const status = document.querySelector("#logs-status");
  document.querySelector("#logs-title").textContent = `Logs — ${container.name}`;
  output.textContent = "";
  status.textContent = "Following in real time";
  modals.logs.show();
  const process = command(["docker", "logs", "--follow", "--tail", "200", "--timestamps", container.id], { err: "out", batch: 4096, latency: 200 });
  activeLogProcess = process;
  process.stream(data => {
    const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 80;
    output.textContent += data;
    if (follow) output.scrollTop = output.scrollHeight;
  });
  process.then(() => finishLogs(process, "Stream ended")).catch(error => {
    if (error.problem !== "cancelled") finishLogs(process, error.message || "Log stream failed");
  });
}

function finishLogs(process, message) {
  if (activeLogProcess === process) activeLogProcess = null;
  document.querySelector("#logs-status").textContent = message;
}

function stopLogs() {
  if (activeLogProcess) activeLogProcess.close("cancelled");
  activeLogProcess = null;
}
