export function command(args, options = {}) {
  return cockpit.spawn(args, { superuser: "try", err: "message", ...options });
}

export function parseJsonLines(output) {
  return output.split("\n").map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
}

export async function inspect(kind, id) {
  const output = await command(["docker", kind, "inspect", id]);
  return JSON.stringify(JSON.parse(output), null, 2);
}
