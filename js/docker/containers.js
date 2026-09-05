import { command } from "../core/docker.js";
import { state } from "../core/state.js";
import { actionButton, confirmAction, confirmActionWithOptions, escapeHtml, modals, openLogs, showAlert, showDetails } from "../core/ui.js";
import { validArgument } from "../core/validation.js";

const ACTIONS = new Set(["start", "stop", "restart"]);
let portChange = null;

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
    return `<div class="btn-group btn-group-sm actions-group">${actionButton("container-inspect", row.id, "info-circle", "Details", "outline-primary")}${actionButton("logs", row.id, "terminal", "Logs", "outline-primary")}${actionButton("container-ports", row.id, "ethernet", "Alterar portas")}${running ? actionButton("restart", row.id, "arrow-repeat", "Restart") : ""}${actionButton(running ? "stop" : "start", row.id, running ? "stop-fill" : "play-fill", running ? "Stop" : "Start", running ? "outline-danger" : "outline-success")}${actionButton("container-remove", row.id, "trash", "Remove", "outline-danger")}</div>`;
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
  else if (action === "container-remove") void openRemoveContainer(container);
  else if (action === "container-ports") void openPortForm(container);
  else if (ACTIONS.has(action)) confirmAction(`${action} container`, `Run “${action}” on “${container.name}”?`, () => command(["docker", action, id]));
  else return false;
  return true;
}

async function inUse(filter, resource, containerId) {
  const output = await command(["docker", "container", "ls", "-aq", "--filter", `${filter}=${resource}`]);
  return output.split("\n").filter(Boolean).some(id => id !== containerId);
}

async function openRemoveContainer(container) {
  try {
    const [details] = JSON.parse(await command(["docker", "container", "inspect", container.id]));
    const imageInUse = await inUse("ancestor", details.Image, container.id);
    const volumes = [...new Set(details.Mounts.filter(mount => mount.Type === "volume").map(mount => mount.Name))];
    const volumeUse = await Promise.all(volumes.map(async volume => [volume, await inUse("volume", volume, container.id)]));
    const removableVolumes = volumeUse.filter(([, used]) => !used).map(([volume]) => volume);
    const options = [];
    if (!imageInUse) options.push({ id: "remove-container-image", value: "image", label: "Remover a imagem associada, que não é usada por outro container" });
    for (const [index, volume] of removableVolumes.entries()) options.push({ id: `remove-container-volume-${index}`, value: `volume:${volume}`, label: `Remover o volume “${volume}”, que não é usado por outro container` });
    if (imageInUse || removableVolumes.length !== volumes.length) options.push({ id: "unavailable-resources", value: "", label: "Alguns recursos compartilhados serão preservados", disabled: true });
    confirmActionWithOptions("Remover container", `Remover “${container.name}”? Esta ação não pode ser desfeita.`, options, async selected => {
      await command(["docker", "container", "rm", "--force", container.id]);
      if (selected.includes("image")) await command(["docker", "image", "rm", details.Image]);
      for (const value of selected.filter(value => value.startsWith("volume:"))) await command(["docker", "volume", "rm", value.slice("volume:".length)]);
    });
  } catch (error) {
    showAlert(error.message || "The container could not be prepared for removal.");
  }
}

export async function openPortForm(container) {
  try {
    const [details] = JSON.parse(await command(["docker", "container", "inspect", container.id]));
    const bindings = Object.entries(details.HostConfig.PortBindings || {}).flatMap(([containerPort, items]) => (items || []).map(item => ({ containerPort, hostIp: item.HostIp || "", hostPort: item.HostPort || "" })));
    if (!bindings.length) throw new Error("This container has no published ports to change.");
    portChange = { container, details };
    portChange.bindings = bindings;
    document.querySelector("#form-title").textContent = `Alterar portas — ${container.name}`;
    const inputs = bindings.map((binding, index) => `<div class="row g-2 align-items-end mb-3"><div class="col-md-5"><label class="form-label">Porta do container</label><input class="form-control" value="${escapeHtml(binding.containerPort)}" readonly></div><div class="col-md-3"><label class="form-label">IP do host</label><input class="form-control" value="${escapeHtml(binding.hostIp || "Todas as interfaces")}" readonly></div><div class="col-md-4"><label class="form-label" for="field-host-port-${index}">Porta no host</label><input class="form-control" id="field-host-port-${index}" name="hostPort-${index}" value="${escapeHtml(binding.hostPort)}" required></div></div>`).join("");
    document.querySelector("#form-fields").innerHTML = `<div class="alert alert-warning">O Docker recriará o container uma vez, aplicando todas as portas abaixo. O container antigo só será removido depois que o novo iniciar com sucesso.</div>${inputs}`;
    document.querySelector("#resource-form").dataset.handler = "container-port";
    modals.form.show();
  } catch (error) {
    showAlert(error.message || "The container ports could not be loaded.");
  }
}

function addPortBinding(args, containerPort, binding) {
  const [port, protocol] = containerPort.split("/");
  const host = binding.HostPort ? `${binding.HostIp ? `${binding.HostIp}:` : ""}${binding.HostPort}:${port}/${protocol}` : `${port}/${protocol}`;
  args.push("--publish", host);
}

export async function submitContainerPortForm(data) {
  if (!portChange) throw new Error("Container configuration was not loaded.");
  const bindings = portChange.bindings.map((binding, index) => ({ ...binding, hostPort: data.get(`hostPort-${index}`).trim() }));
  if (bindings.some(binding => !/^\d{1,5}$/.test(binding.hostPort) || Number(binding.hostPort) > 65535 || !validArgument(binding.hostPort))) throw new Error("Enter valid host ports.");
  const { container, details } = portChange;
  const temporaryName = `${container.name}-replacement-${Date.now()}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const config = details.Config;
  const hostConfig = details.HostConfig;
  const args = ["docker", "container", "create", "--name", temporaryName];
  if (hostConfig.RestartPolicy?.Name && hostConfig.RestartPolicy.Name !== "no") args.push("--restart", hostConfig.RestartPolicy.Name === "on-failure" && hostConfig.RestartPolicy.MaximumRetryCount ? `on-failure:${hostConfig.RestartPolicy.MaximumRetryCount}` : hostConfig.RestartPolicy.Name);
  for (const environment of config.Env || []) args.push("--env", environment);
  for (const [key, value] of Object.entries(config.Labels || {})) args.push("--label", `${key}=${value}`);
  if (config.User) args.push("--user", config.User);
  if (config.WorkingDir) args.push("--workdir", config.WorkingDir);
  for (const mount of details.Mounts) {
    if (!["volume", "bind"].includes(mount.Type)) continue;
    const source = mount.Type === "volume" ? mount.Name : mount.Source;
    args.push("--volume", `${source}:${mount.Destination}${mount.RW ? "" : ":ro"}`);
  }
  for (const binding of bindings) addPortBinding(args, binding.containerPort, { HostPort: binding.hostPort, HostIp: binding.hostIp });
  if (config.Entrypoint?.length) args.push("--entrypoint", config.Entrypoint.join(" "));
  const networks = Object.keys(details.NetworkSettings.Networks || {});
  if (networks.length) args.push("--network", networks[0]);
  args.push(details.Image, ...(config.Cmd || []));
  let replacementId;
  try {
    replacementId = (await command(args)).trim();
    for (const network of networks.slice(1)) await command(["docker", "network", "connect", network, replacementId]);
    if (isRunning(container)) {
      await command(["docker", "container", "stop", container.id]);
      try {
        await command(["docker", "container", "start", replacementId]);
      } catch (error) {
        await command(["docker", "container", "rm", replacementId]);
        await command(["docker", "container", "start", container.id]);
        throw error;
      }
    }
    await command(["docker", "container", "rm", container.id]);
    await command(["docker", "container", "rename", replacementId, container.name]);
  } finally {
    portChange = null;
  }
}
