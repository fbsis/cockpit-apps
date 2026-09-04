import { command, parseJsonLines } from "./core/docker.js";
import { replaceState, state } from "./core/state.js";
import { initializeUi, modals, setLoading, showAlert } from "./core/ui.js";
import { handleContainerAction, normalizeContainer, registerContainerFormatters, renderContainers } from "./docker/containers.js";
import { handleImageAction, normalizeImage, openImageForm, registerImageFormatters, renderImages, submitImageForm } from "./docker/images.js";
import { handleVolumeAction, normalizeVolume, openVolumeForm, registerVolumeFormatters, renderVolumes, submitVolumeForm } from "./docker/volumes.js";
import { handleNetworkAction, normalizeNetwork, openNetworkForm, registerNetworkFormatters, renderNetworks, submitNetworkForm } from "./docker/networks.js";

function registerFormatters() {
  registerContainerFormatters();
  registerImageFormatters();
  registerVolumeFormatters();
  registerNetworkFormatters();
}

function renderAll() {
  renderContainers();
  renderImages();
  renderVolumes();
  renderNetworks();
  for (const name of ["containers", "images", "volumes", "networks"]) document.querySelector(`#${name}-badge`).textContent = state[name].length;
}

async function loadAll() {
  setLoading(true);
  try {
    const [containers, images, volumes, networks, version] = await Promise.all([
      command(["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "image", "ls", "-a", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "volume", "ls", "--format", "{{json .}}"]),
      command(["docker", "network", "ls", "--no-trunc", "--format", "{{json .}}"]),
      command(["docker", "version", "--format", "{{.Server.Version}}"]),
    ]);
    replaceState({ containers: parseJsonLines(containers).map(normalizeContainer), images: parseJsonLines(images).map(normalizeImage), volumes: parseJsonLines(volumes).map(normalizeVolume), networks: parseJsonLines(networks).map(normalizeNetwork) });
    renderAll();
    document.querySelector("#docker-version").textContent = `v${version.trim()}`;
    const status = document.querySelector("#docker-status");
    status.className = "badge text-bg-success";
    status.textContent = "Docker connected";
  } catch (error) {
    document.querySelector("#docker-status").className = "badge text-bg-danger";
    document.querySelector("#docker-status").textContent = "Docker unavailable";
    showAlert(error.message || "Docker could not be queried.");
  } finally {
    setLoading(false);
  }
}

function handleClick(event) {
  const create = event.target.closest("[data-create]");
  if (create?.dataset.create === "image") return openImageForm("pull");
  if (create?.dataset.create === "volume") return openVolumeForm();
  if (create?.dataset.create === "network") return openNetworkForm("create");
  const button = event.target.closest("[data-resource-action]");
  if (!button) return;
  const { resourceAction: action, resourceId: id } = button.dataset;
  if (handleContainerAction(action, id) || handleImageAction(action, id) || handleVolumeAction(action, id) || handleNetworkAction(action, id)) return;
  showAlert("Resource not found.");
}

async function handleForm(event) {
  event.preventDefault();
  const { handler, mode, key, id } = event.currentTarget.dataset;
  const data = new FormData(event.currentTarget);
  const button = document.querySelector("#save-resource-button");
  button.disabled = true;
  try {
    if (handler === "image") await submitImageForm(data, mode, key);
    else if (handler === "volume") await submitVolumeForm(data);
    else if (handler === "network") await submitNetworkForm(data, mode, id);
    else throw new Error("Unknown form.");
    modals.form.hide();
    showAlert("Operation completed successfully.", "success");
    await loadAll();
  } catch (error) {
    showAlert(error.message || "The resource could not be saved.");
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  registerFormatters();
  initializeUi(loadAll);
  for (const id of ["containers-table", "images-table", "volumes-table", "networks-table"]) $(`#${id}`).bootstrapTable();
  document.addEventListener("click", handleClick);
  document.querySelector("#resource-form").addEventListener("submit", handleForm);
  document.querySelector("#refresh-button").addEventListener("click", loadAll);
  document.querySelector("#state-filter").addEventListener("change", renderContainers);
  loadAll();
});
