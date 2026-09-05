#!/usr/bin/env python3
"""Per-user scheduled backups derived from cockpit-navigator (GPL-3.0-or-later)."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SCRIPT_PATH = "/usr/local/share/cockpit/cockpit-apps/scripts/backup.py3"
PREFIX = "cockpit-apps-backup"
LEGACY_CALENDARS = {"0 */2 * * *": "*-*-* 00/2:00:00", "0 */6 * * *": "*-*-* 00/6:00:00", "0 2 * * *": "*-*-* 02:00:00"}

def require_root():
    if os.geteuid() != 0:
        raise ValueError("Backup is currently configured for the root user only.")

def config_path(): return Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser() / "cockpit-apps" / "backups.json"
def cache_dir():
    path = Path(os.environ.get("XDG_CACHE_HOME", "~/.cache")).expanduser() / "cockpit-apps" / "backups"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
def unit_dir():
    path = Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser() / "systemd" / "user"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
def load_config():
    path = config_path()
    if not path.exists(): return {"jobs": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict): raise ValueError("Backup configuration must be a JSON object.")
    data.setdefault("jobs", [])
    return data
def save_config(config):
    path = config_path(); path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(config, output, indent=2, sort_keys=True); output.write("\n"); output.flush(); os.fsync(output.fileno())
    os.chmod(temporary, 0o600); os.replace(temporary, path)
def jobs(): return load_config().get("jobs", [])
def unit_name(job_id, suffix): return f"{PREFIX}@{job_id}.{suffix}"
def validate_id(job_id):
    if not re.fullmatch(r"[a-z0-9-]+", job_id): raise ValueError("Invalid backup job ID.")
def log_path(job_id): return cache_dir() / f"{job_id}.log"
def write_log(job_id, message):
    with log_path(job_id).open("a", encoding="utf-8") as output:
        output.write(f"{datetime.datetime.now().astimezone().isoformat(timespec='seconds')} {message}\n")
def calendar(job):
    value = job.get("onCalendar") or LEGACY_CALENDARS.get(job.get("schedule"), "")
    if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value: raise ValueError("Backup schedule must be a single-line systemd OnCalendar expression.")
    return value.strip()
def validate_calendar(value): subprocess.run(["systemd-analyze", "calendar", value], check=True, capture_output=True, text=True)
def validate(job):
    if not isinstance(job, dict): raise ValueError("Invalid backup job.")
    validate_id(str(job.get("id", "")))
    if not isinstance(job.get("name"), str) or not job["name"].strip() or "\n" in job["name"]: raise ValueError("Invalid backup name.")
    if job.get("mode", "rsync") not in ("rsync", "snapshot"): raise ValueError("Invalid backup mode.")
    for field in (("source",) if job.get("mode") == "snapshot" else ("source", "destination")):
        if not isinstance(job.get(field), str) or not os.path.isabs(job[field]): raise ValueError(f"Backup {field} must be an absolute path.")
    for field in ("enabled", "snapshotSource", "snapshotDestination"): job[field] = bool(job.get(field))
    job["snapshotRetention"] = max(0, int(job.get("snapshotRetention", 0) or 0))
    if job["mode"] == "snapshot": job["snapshotSource"] = True; job.pop("destination", None)
    if job["enabled"]: validate_calendar(calendar(job))
def write_unit(path, content):
    temporary = path.with_suffix(path.suffix + ".tmp"); temporary.write_text(content, encoding="utf-8"); os.chmod(temporary, 0o600); os.replace(temporary, path)
def userctl(args, **kwargs): return subprocess.run(["systemctl", "--user", *args], **kwargs)
def sync_systemd():
    config = load_config(); configured = set()
    for job in config["jobs"]:
        validate(job); configured.add(job["id"])
        service = "\n".join(["[Unit]", f"Description=Cockpit Apps backup {job['id']}", "", "[Service]", "Type=oneshot", f"ExecStart={SCRIPT_PATH} run {job['id']}", ""])
        write_unit(unit_dir() / unit_name(job["id"], "service"), service)
        timer = unit_dir() / unit_name(job["id"], "timer")
        if job["enabled"]:
            content = "\n".join(["[Unit]", f"Description=Cockpit Apps backup schedule {job['id']}", "", "[Timer]", f"OnCalendar={calendar(job)}", "Persistent=true", f"Unit={unit_name(job['id'], 'service')}", "", "[Install]", "WantedBy=timers.target", ""])
            write_unit(timer, content)
        else:
            userctl(["disable", "--now", timer.name], capture_output=True); timer.unlink(missing_ok=True)
    for suffix in ("timer", "service"):
        for path in unit_dir().glob(f"{PREFIX}@*.{suffix}"):
            job_id = path.name[len(PREFIX) + 1: -len(suffix) - 1]
            if job_id not in configured:
                userctl(["disable", "--now", path.name], capture_output=True); path.unlink(missing_ok=True); log_path(job_id).unlink(missing_ok=True)
    userctl(["daemon-reload"], check=True, capture_output=True)
    enabled = 0
    for job in config["jobs"]:
        if job["enabled"]:
            userctl(["enable", "--now", unit_name(job["id"], "timer")], check=True, capture_output=True); enabled += 1
    return {"jobs": enabled}
def zfs_dataset(path):
    result = subprocess.run(["findmnt", "--json", "--target", path, "--output", "FSTYPE,SOURCE"], check=True, text=True, capture_output=True)
    filesystems = json.loads(result.stdout).get("filesystems", []); filesystem = filesystems[0] if filesystems else {}
    return filesystem.get("source") if filesystem.get("fstype") == "zfs" else None
def detect_zfs(path):
    if not os.path.isabs(path): raise ValueError("Path must be absolute.")
    dataset = zfs_dataset(path)
    return {"supported": bool(dataset), "dataset": dataset}
def snapshot_metrics(dataset, job_id, retention):
    prefixes = (f"{dataset}@{PREFIX}-{job_id}-", f"{dataset}@navigator-{job_id}-")
    result = subprocess.run(["zfs", "list", "-H", "-t", "snapshot", "-o", "name", "-s", "creation", "-r", dataset], check=True, text=True, capture_output=True)
    snapshots = [name for name in result.stdout.splitlines() if name.startswith(prefixes)]
    removed = 0
    if retention:
        for item in snapshots[:-retention]: subprocess.run(["zfs", "destroy", item], check=True, capture_output=True); removed += 1
        snapshots = snapshots[-retention:]
    return {"kept": len(snapshots), "removed": removed}
def rsync_metrics(output):
    metrics = {}
    for line in output.splitlines():
        if line.startswith("Number of files:"): metrics["files"] = line.split(":", 1)[1].strip()
        elif line.startswith("Total transferred file size:"): metrics["transferred"] = line.split(":", 1)[1].strip()
    return metrics
def process_output(job_id, output):
    if output:
        for line in output.decode(errors="replace").splitlines(): write_log(job_id, f"rsync: {line}")
def run_job(job_id):
    validate_id(job_id)
    config = load_config(); job = next((item for item in config["jobs"] if item.get("id") == job_id), None)
    if not job: raise ValueError("Backup job not found.")
    validate(job); source = os.path.realpath(job["source"]); destination = os.path.realpath(job["destination"]) if job["mode"] == "rsync" else None
    if not os.path.isdir(source): raise ValueError("Backup source must be an existing directory.")
    if destination and (source == destination or destination.startswith(source.rstrip("/") + "/")): raise ValueError("Backup destination cannot be the source or a folder inside it.")
    with (cache_dir() / f"{job_id}.lock").open("w") as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {"skipped": True, "message": "Backup is already running."}
        started = datetime.datetime.now(datetime.timezone.utc)
        try:
            write_log(job_id, f"Started {job['mode']} job."); datasets = set()
            checks = [(source, job["snapshotSource"])] + ([(destination, job["snapshotDestination"])] if destination else [])
            for path, enabled in checks:
                if enabled:
                    dataset = zfs_dataset(path)
                    if not dataset: raise ValueError(f"Snapshot requested but {path} is not on ZFS.")
                    datasets.add(dataset)
            stamp = started.strftime("%Y%m%d-%H%M%S")
            for dataset in datasets:
                name = f"{dataset}@{PREFIX}-{job_id}-{stamp}"; subprocess.run(["zfs", "snapshot", name], check=True, capture_output=True); write_log(job_id, f"Created snapshot {name}.")
            snapshots = {"kept": 0, "removed": 0}
            for dataset in datasets:
                result = snapshot_metrics(dataset, job_id, job["snapshotRetention"]); snapshots["kept"] += result["kept"]; snapshots["removed"] += result["removed"]
            metrics = {}
            if destination:
                os.makedirs(destination, exist_ok=True)
                result = subprocess.run(["rsync", "-aHAX", "--numeric-ids", "--stats", "--itemize-changes", source.rstrip("/") + "/", destination.rstrip("/") + "/"], check=True, capture_output=True)
                process_output(job_id, result.stdout); metrics = rsync_metrics(result.stdout.decode())
            finished = datetime.datetime.now(datetime.timezone.utc)
            job["lastRun"] = {"status": "success", "at": started.isoformat(), "durationSeconds": round((finished - started).total_seconds()), "metrics": {**metrics, "snapshots": snapshots["kept"], "snapshotsRemoved": snapshots["removed"]}}
            write_log(job_id, "Completed successfully."); save_config(config); return {"mode": job["mode"], "source": source, "destination": destination}
        except Exception as error:
            job["lastRun"] = {"status": "error", "at": started.isoformat(), "error": str(error)}; process_output(job_id, getattr(error, "stdout", b"") or b""); process_output(job_id, getattr(error, "stderr", b"") or b""); write_log(job_id, f"Failed: {error}"); save_config(config); raise
def status(job_id):
    validate_id(job_id)
    result = userctl(["show", unit_name(job_id, "service"), "--property=LoadState,ActiveState,SubState,Result"], text=True, capture_output=True)
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line); active = values.get("ActiveState", "inactive")
    return {"running": active in ("active", "activating"), "activeState": active, "subState": values.get("SubState", "dead"), "result": values.get("Result", "unknown"), "loaded": values.get("LoadState") == "loaded"}
def import_navigator():
    path = Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser() / "cockpit-navigator" / "config.json"
    if not path.exists(): return {"imported": 0}
    source = json.loads(path.read_text(encoding="utf-8")); incoming = source.get("backups", {}).get("jobs", [])
    config = load_config(); existing = {job.get("id") for job in config["jobs"]}; added = [job for job in incoming if job.get("id") not in existing]
    for job in added: validate(job)
    config["jobs"].extend(added); save_config(config); sync_systemd(); return {"imported": len(added)}
def respond(value): print(json.dumps({"ok": True, **value}))
def main():
    try:
        require_root(); action = sys.argv[1]
        if action == "list":
            result = jobs()
            for job in result: job["status"] = status(job["id"])
            respond({"jobs": result})
        elif action == "save":
            job = json.load(sys.stdin); validate(job); config = load_config(); config["jobs"] = [item for item in config["jobs"] if item.get("id") != job["id"]] + [job]; save_config(config); respond(sync_systemd())
        elif action == "delete":
            validate_id(sys.argv[2]); config = load_config(); config["jobs"] = [item for item in config["jobs"] if item.get("id") != sys.argv[2]]; save_config(config); respond(sync_systemd())
        elif action == "start": validate_id(sys.argv[2]); userctl(["start", "--no-block", unit_name(sys.argv[2], "service")], check=True, capture_output=True); respond({"started": True})
        elif action == "logs":
            job_id = sys.argv[2]; validate_id(job_id); lines = log_path(job_id).read_text(encoding="utf-8").splitlines()[-50:] if log_path(job_id).exists() else []
            journal = subprocess.run(["journalctl", "--user", "--no-pager", "--output=short-iso", "--lines=50", "--unit", unit_name(job_id, "service")], text=True, capture_output=True).stdout.splitlines()[-50:]; respond({"lines": lines, "journal": journal})
        elif action == "detect-zfs": respond(detect_zfs(sys.argv[2]))
        elif action == "import-navigator": respond(import_navigator())
        elif action == "run": respond(run_job(sys.argv[2]))
        else: raise ValueError("Invalid action.")
    except Exception as error: print(json.dumps({"ok": False, "error": str(error)})); return 1
    return 0
if __name__ == "__main__": sys.exit(main())
