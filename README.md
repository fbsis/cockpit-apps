# Cockpit Apps

Simple extensions for the [Cockpit Project](https://cockpit-project.org/).

## Docker

The first app provides a streamlined interface for viewing and managing Docker
containers, images, volumes, and networks without leaving Cockpit. The interface
uses vanilla JavaScript, Bootstrap, and Bootstrap Table loaded from a CDN.

Available features:

- list, search, start, stop, and restart containers;
- follow logs and inspect configurations;
- pull, tag, inspect, and remove images;
- create, inspect, and remove volumes;
- create and inspect networks, connect or disconnect containers, and remove networks.

Images, volumes, and networks have immutable properties in Docker. Therefore,
the interface does not pretend to support changes that the engine cannot make:
images are edited by adding tags, networks are edited through their container
connections, and structural changes to volumes or networks require recreation.

## Requirements

- Linux with Cockpit installed and running;
- Docker Engine and Docker CLI available on the host;
- a user authorized to run Docker or obtain administrative access through Cockpit;
- browser access to `cdn.jsdelivr.net`, used by Bootstrap and Bootstrap Table.

Verify the requirements before installation:

```bash
cockpit-bridge --version
docker version
```

## System-wide installation

Cockpit looks for system packages in `/usr/local/share/cockpit`. Clone the
repository directly into that directory:

```bash
sudo mkdir -p /usr/local/share/cockpit
sudo git clone https://github.com/fbsis/cockpit-apps.git \
  /usr/local/share/cockpit/cockpit-apps
```

Confirm that Cockpit discovered the manifest:

```bash
cockpit-bridge --packages
```

Open Cockpit, usually at `https://SERVER:9090`. If a session was already open,
sign in again, then select **Docker** under the **System** section.

The app runs Docker through the session authenticated by Cockpit and attempts to
request administrative access when required. The Docker socket is never exposed
to the browser.

## Updating

```bash
sudo git -C /usr/local/share/cockpit/cockpit-apps pull --ff-only
```

Reload Cockpit after updating. If the previous version remains open, sign out
and back in to create a new bridge session.

## Uninstalling

Remove only this package directory:

```bash
sudo rm -rf /usr/local/share/cockpit/cockpit-apps
```

This removes only the user interface. Docker containers, images, volumes, and
networks are not changed.

## Development

Create a symbolic link to the project inside Cockpit's user package directory:

```bash
mkdir -p ~/.local/share/cockpit
ln -s "$PWD" ~/.local/share/cockpit/cockpit-apps
```

Open Cockpit and select **Docker** under the **System** section. Packages in the
user directory are not subject to the aggressive caching used for system packages.

To verify that Cockpit discovered the package:

```bash
cockpit-bridge --packages
```

To remove the development link:

```bash
rm ~/.local/share/cockpit/cockpit-apps
```

## Project structure

The project is split by responsibility so each Docker resource can evolve
without turning the entry point into a large, multi-purpose file:

```text
cockpit-apps/
├── manifest.json
├── index.html
├── app.css
├── css/
│   └── docker.css
└── js/
    ├── main.js
    ├── core/
    │   ├── docker.js
    │   ├── state.js
    │   ├── ui.js
    │   └── validation.js
    └── docker/
        ├── containers.js
        ├── images.js
        ├── volumes.js
        └── networks.js
```

`js/main.js` only coordinates loading and events. Shared Cockpit/Docker access,
state, validation, and modal behavior live under `js/core`, while each file in
`js/docker` owns the normalization, table formatting, forms, and actions for one
Docker resource type.
