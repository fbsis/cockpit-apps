# Cockpit Apps

Collection of independent extensions for the [Cockpit Project](https://cockpit-project.org/).

## Apps

The package currently provides two applications, each with its own Cockpit menu entry:

- **Docker** provides a streamlined interface for viewing and managing Docker
containers, images, volumes, and networks without leaving Cockpit. The interface
uses vanilla JavaScript, Bootstrap, and Bootstrap Table loaded from a CDN.
- **Backup** manages scheduled `rsync` copies, manual runs, logs, status, and optional
  ZFS snapshots with retention through systemd timers.

### App de Docker

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

### Backup

Backup jobs run as system services. Their configuration is saved at
`/etc/cockpit-apps/backups.json`, logs at `/var/cache/cockpit-apps/backups`, and
systemd units use the `cockpit-apps-backup@` prefix. The module requires `rsync`
and systemd; ZFS is required only when snapshots are enabled.

The backup helper is derived from the GPL-3.0-or-later Backup module in
[fbsis/cockpit-navigator](https://github.com/fbsis/cockpit-navigator). See
`BACKUP_NOTICE.md` for attribution.

## Requirements

- Linux with Cockpit installed and running;
- Docker Engine and Docker CLI available on the host;
- a user authorized to run Docker or obtain administrative access through Cockpit;
- browser access to `cdn.jsdelivr.net`, used by Bootstrap and Bootstrap Table.
- `rsync` and systemd to use the Backup app; ZFS tools are optional.

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
sign in again, then select **Docker** or **Backup** under the **System** section.

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

Open Cockpit and select **Docker** or **Backup** under the **System** section. Packages in the
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

The project is split into independent Cockpit applications:

```text
cockpit-apps/
├── manifest.json
├── index.html
├── app.css
├── css/docker.css
├── js/
├── backup.html
├── backup.js
├── backup.css
├── scripts/backup.py3
└── BACKUP_NOTICE.md
```

The Docker application keeps shared Cockpit/Docker access, state, validation, and modal
behavior under `js/core`, while each resource module lives in `js/docker`. The Backup
page and its helper are independent from the Docker interface.
