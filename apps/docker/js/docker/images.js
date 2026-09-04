import { command } from "../core/docker.js";
import { state } from "../core/state.js";
import { actionButton, confirmAction, escapeHtml, field, modals, showAlert, showDetails } from "../core/ui.js";
import { validArgument } from "../core/validation.js";

export function normalizeImage(item, index) {
  const repository = item.Repository || "<none>";
  const tag = item.Tag || "<none>";
  return { id: item.ID, key: `${item.ID}|${repository}:${tag}|${index}`, repository, tag, created: item.CreatedSince || item.CreatedAt || "—", size: item.Size || "—" };
}

export const imageReference = image => image.repository !== "<none>" && image.tag !== "<none>" ? `${image.repository}:${image.tag}` : image.id;

export function registerImageFormatters() {
  window.imageNameFormatter = (value, row) => `<div class="fw-semibold">${escapeHtml(value)}</div><div class="resource-id text-body-secondary">${escapeHtml(row.id.replace("sha256:", "").slice(0, 12))}</div>`;
  window.imageActionsFormatter = (_value, row) => `<div class="btn-group btn-group-sm actions-group">${actionButton("image-inspect", row.key, "info-circle", "Details", "outline-primary")}${actionButton("image-tag", row.key, "tag", "Add tag")}${actionButton("image-remove", row.key, "trash", "Remove", "outline-danger")}</div>`;
}

export const renderImages = () => $("#images-table").bootstrapTable("load", state.images);

export function handleImageAction(action, key) {
  const image = state.images.find(item => item.key === key);
  if (!image) return false;
  if (action === "image-inspect") showDetails("image", image.id, `Image — ${imageReference(image)}`);
  else if (action === "image-tag") openImageForm("tag", image);
  else if (action === "image-remove") confirmAction("Remove image", `Remove “${imageReference(image)}”? Dependent containers may prevent this operation.`, () => command(["docker", "image", "rm", imageReference(image)]));
  else return false;
  return true;
}

export function openImageForm(mode, image = null) {
  const title = mode === "pull" ? "Pull image" : "Add image tag";
  const name = mode === "pull" ? "reference" : "target";
  document.querySelector("#form-title").textContent = title;
  document.querySelector("#form-fields").innerHTML = field(name, mode === "pull" ? "Image" : "New reference", "", "Example: nginx:latest");
  document.querySelector("#resource-form").dataset.handler = "image";
  document.querySelector("#resource-form").dataset.mode = mode;
  document.querySelector("#resource-form").dataset.key = image?.key || "";
  modals.form.show();
}

export async function submitImageForm(data, mode, key) {
  const value = data.get(mode === "pull" ? "reference" : "target").trim();
  if (!validArgument(value)) throw new Error("Enter a valid image reference.");
  if (mode === "pull") return command(["docker", "image", "pull", value]);
  const image = state.images.find(item => item.key === key);
  if (!image) throw new Error("Image not found.");
  return command(["docker", "image", "tag", imageReference(image), value]);
}
