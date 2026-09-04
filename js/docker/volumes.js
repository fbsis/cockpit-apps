import { command } from "../core/docker.js";
import { state } from "../core/state.js";
import { actionButton, confirmAction, field, modals, showDetails } from "../core/ui.js";
import { RESOURCE_NAME } from "../core/validation.js";

export const normalizeVolume = item => ({ name: item.Name, driver: item.Driver || "local", scope: item.Scope || "local", mountpoint: item.Mountpoint || "—" });

export function registerVolumeFormatters() {
  window.volumeActionsFormatter = (_value, row) => `<div class="btn-group btn-group-sm actions-group">${actionButton("volume-inspect", row.name, "info-circle", "Details", "outline-primary")}${actionButton("volume-remove", row.name, "trash", "Remove", "outline-danger")}</div>`;
}

export const renderVolumes = () => $("#volumes-table").bootstrapTable("load", state.volumes);

export function handleVolumeAction(action, name) {
  const volume = state.volumes.find(item => item.name === name);
  if (!volume) return false;
  if (action === "volume-inspect") showDetails("volume", name, `Volume — ${name}`);
  else if (action === "volume-remove") confirmAction("Remove volume", `Remove “${name}”? Its data will be permanently lost.`, () => command(["docker", "volume", "rm", name]));
  else return false;
  return true;
}

export function openVolumeForm() {
  document.querySelector("#form-title").textContent = "Create volume";
  document.querySelector("#form-fields").innerHTML = field("name", "Name") + field("driver", "Driver", "local") + '<div class="mb-3"><label class="form-label" for="field-labels">Labels</label><textarea class="form-control" id="field-labels" name="labels" rows="3" placeholder="environment=production"></textarea><div class="form-text">One key=value label per line.</div></div>';
  document.querySelector("#resource-form").dataset.handler = "volume";
  modals.form.show();
}

export async function submitVolumeForm(data) {
  const name = data.get("name").trim();
  const driver = data.get("driver").trim();
  if (!RESOURCE_NAME.test(name) || !RESOURCE_NAME.test(driver)) throw new Error("Invalid name or driver.");
  const args = ["docker", "volume", "create", "--driver", driver];
  for (const label of data.get("labels").split("\n").map(item => item.trim()).filter(Boolean)) {
    if (!/^[a-zA-Z0-9_.-]+=.*/.test(label)) throw new Error(`Invalid label: ${label}`);
    args.push("--label", label);
  }
  args.push(name);
  return command(args);
}
