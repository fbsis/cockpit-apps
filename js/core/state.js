export const state = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
};

export function replaceState(nextState) {
  Object.assign(state, nextState);
}
