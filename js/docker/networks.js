import { command } from "../core/docker.js";
import { state } from "../core/state.js";
import { actionButton, confirmAction, escapeHtml, field, modals, showDetails } from "../core/ui.js";
import { CONTAINER_ID, RESOURCE_NAME, validArgument } from "../core/validation.js";

export const normalizeNetwork = item => ({ id: item.ID, name: item.Name, driver: item.Driver || "—", scope: item.Scope || "local", internal: String(item.Internal).toLowerCase() === "true", ipv6: String(item.IPv6).toLowerCase() === "true" });

export function registerNetworkFormatters() {
  window.booleanFormatter = value => value ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-secondary">No</span>';
  window.networkActionsFormatter = (_value, row) => `<div class="btn-group btn-group-sm actions-group">${actionButton("network-inspect", row.id, "info-circle", "Details", "outline-primary")}${actionButton("network-manage", row.id, "diagram-3", "Edit connections")}${actionButton("network-remove", row.id, "trash", "Remove", "outline-danger", ["bridge", "host", "none"].includes(row.name))}</div>`;
}

export const renderNetworks = () => $("#networks-table").bootstrapTable("load", state.networks);

export function handleNetworkAction(action, id) {
  const network = state.networks.find(item => item.id === id);
  if (!network) return false;
  if (action === "network-inspect") showDetails("network", id, `Network — ${network.name}`);
  else if (action === "network-manage") openNetworkForm("manage", network);
  else if (action === "network-remove") confirmAction("Remove network", `Remove “${network.name}”? It must have no connected containers.`, () => command(["docker", "network", "rm", id]));
  else return false;
  return true;
}

export function openNetworkForm(mode, network = null) {
  document.querySelector("#resource-form").dataset.handler = "network";
  document.querySelector("#resource-form").dataset.mode = mode;
  document.querySelector("#resource-form").dataset.id = network?.id || "";
  if (mode === "create") {
    document.querySelector("#form-title").textContent = "Create network";
    document.querySelector("#form-fields").innerHTML = field("name", "Name") + field("driver", "Driver", "bridge") + field("subnet", "Subnet", "", "Example: 172.30.0.0/16", false) + field("gateway", "Gateway", "", "Example: 172.30.0.1", false) + '<div class="form-check"><input class="form-check-input" type="checkbox" id="field-internal" name="internal"><label class="form-check-label" for="field-internal">Internal network</label></div>';
  } else {
    document.querySelector("#form-title").textContent = `Edit connections — ${network.name}`;
    const options = state.containers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
    document.querySelector("#form-fields").innerHTML = `<div class="mb-3"><label class="form-label" for="field-operation">Operation</label><select class="form-select" id="field-operation" name="operation"><option value="connect">Connect</option><option value="disconnect">Disconnect</option></select></div><div class="mb-3"><label class="form-label" for="field-container">Container</label><select class="form-select" id="field-container" name="container" required>${options}</select></div>`;
  }
  modals.form.show();
}

export async function submitNetworkForm(data, mode, id) {
  if (mode === "manage") {
    const operation = data.get("operation");
    const container = data.get("container");
    if (!["connect", "disconnect"].includes(operation) || !CONTAINER_ID.test(container)) throw new Error("Invalid operation.");
    return command(["docker", "network", operation, id, container]);
  }
  const name = data.get("name").trim();
  const driver = data.get("driver").trim();
  if (!RESOURCE_NAME.test(name) || !RESOURCE_NAME.test(driver)) throw new Error("Invalid name or driver.");
  const args = ["docker", "network", "create", "--driver", driver];
  for (const option of ["subnet", "gateway"]) {
    const value = data.get(option).trim();
    if (value && !validArgument(value)) throw new Error(`Invalid ${option}.`);
    if (value) args.push(`--${option}`, value);
  }
  if (data.get("internal")) args.push("--internal");
  args.push(name);
  return command(args);
}
