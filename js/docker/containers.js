import { command } from "../core/docker.js";
import { state } from "../core/state.js";
import { actionButton, confirmAction, escapeHtml, openLogs, showDetails } from "../core/ui.js";

const ACTIONS = new Set(["start", "stop", "restart"]);

export function normalizeContainer(item) {
  return { id: item.ID, name: item.Names || item.ID.slice(0, 12), image: item.Image || "—", state: (item.State || "unknown").toLowerCase(), status: item.Status || "—", ports: item.Ports || "—" };
}

export const isRunning = container => container.state === "running";

export function registerContainerFormatters() {
  window.nameFormatter = (value, row) => `<div class="fw-semibold">${escapeHtml(value)}</div><div class="resource-id text-body-secondary">${escapeHtml(row.id.slice(0, 12))}</div>`;
  window.stateFormatter = value => {
    const states = { running: ["success", "Running"], exited: ["secondary", "Stopped"], created: ["info", "Created"], paused: ["warning", "Paused"], restarting: ["warning", "Restarting"], dead: ["danger", "Failed"] };
    const [style, label] = states[value] || ["secondary", value || "Unknown"];
    return `<span class="badge text-bg-${style}">${escapeHtml(label)}</span>`;
  };
  window.portsFormatter = value => `<div class="ports-list">${String(value || "—").split(",").map(port => escapeHtml(port.trim())).join("<br>")}</div>`;
  window.containerActionsFormatter = (_value, row) => {
    const running = isRunning(row);
    return `<div class="btn-group btn-group-sm actions-group">${actionButton("container-inspect", row.id, "info-circle", "Details", "outline-primary")}${actionButton("logs", row.id, "terminal", "Logs", "outline-primary")}${running ? actionButton("restart", row.id, "arrow-repeat", "Restart") : ""}${actionButton(running ? "stop" : "start", row.id, running ? "stop-fill" : "play-fill", running ? "Stop" : "Start", running ? "outline-danger" : "outline-success")}</div>`;
  };
}

export function renderContainers() {
  const filter = document.querySelector("#state-filter").value;
  const rows = filter === "running" ? state.containers.filter(isRunning) : filter === "stopped" ? state.containers.filter(item => !isRunning(item)) : state.containers;
  $("#containers-table").bootstrapTable("load", rows);
  const running = state.containers.filter(isRunning).length;
  document.querySelector("#total-count").textContent = state.containers.length;
  document.querySelector("#running-count").textContent = running;
  document.querySelector("#stopped-count").textContent = state.containers.length - running;
}

export function handleContainerAction(action, id) {
  const container = state.containers.find(item => item.id === id);
  if (!container) return false;
  if (action === "logs") openLogs(container);
  else if (action === "container-inspect") showDetails("container", id, `Container — ${container.name}`);
  else if (ACTIONS.has(action)) confirmAction(`${action} container`, `Run “${action}” on “${container.name}”?`, () => command(["docker", action, id]));
  else return false;
  return true;
}
