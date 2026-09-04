export const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;
export const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function validArgument(value) {
  return Boolean(value && value.length <= 255 && !value.startsWith("-") && !/\s/.test(value));
}
