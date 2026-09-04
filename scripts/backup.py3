#!/usr/bin/env python3
"""Backup module derived from cockpit-navigator (GPL-3.0-or-later)."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SCRIPT_PATH = "/usr/local/share/cockpit/cockpit-apps/scripts/backup.py3"
CONFIG_PATH = Path("/etc/cockpit-apps/backups.json")
UNIT_DIRECTORY = Path("/etc/systemd/system")
PREFIX = "cockpit-apps-backup"

def jobs():
    if not CONFIG_PATH.exists(): return []
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return data.get("jobs", []) if isinstance(data, dict) and isinstance(data.get("jobs", []), list) else []

def save_jobs(items):
    CONFIG_PATH.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = CONFIG_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps({"jobs": items}, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, CONFIG_PATH)

def validate(job):
    if not isinstance(job, dict) or not re.fullmatch(r"[a-f0-9-]{36}", str(job.get("id", ""))): raise ValueError("Identificador de backup inválido.")
    for field in ("name", "source", "destination", "onCalendar"):
        value = job.get(field)
        if not isinstance(value, str) or not value.strip(): raise ValueError(f"Campo inválido: {field}.")
    if not os.path.isabs(job["source"]) or not os.path.isabs(job["destination"]): raise ValueError("Origem e destino devem ser caminhos absolutos.")
    if "\n" in job["onCalendar"] or "\r" in job["onCalendar"]: raise ValueError("O agendamento deve ocupar apenas uma linha.")
    job["snapshotRetention"] = max(0, int(job.get("snapshotRetention", 0)))
    for field in ("enabled", "snapshotSource", "snapshotDestination"): job[field] = bool(job.get(field))

def unit_name(job_id, suffix): return f"{PREFIX}@{job_id}.{suffix}"
def cache_directory():
    path = Path("/var/cache/cockpit-apps/backups")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
def log_path(job_id): return cache_directory() / f"{job_id}.log"
def write_log(job_id, message):
    with log_path(job_id).open("a", encoding="utf-8") as output: output.write(f"{datetime.datetime.now().astimezone().isoformat(timespec='seconds')} {message}\n")
def write_unit(name, content):
    temporary = (UNIT_DIRECTORY / name).with_suffix(".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, UNIT_DIRECTORY / name)

def sync_systemd(items):
    UNIT_DIRECTORY.mkdir(mode=0o755, parents=True, exist_ok=True)
    expected = set()
    for job in items:
        validate(job); expected.add(job["id"])
        service = "\n".join(["[Unit]", f"Description=Cockpit Apps backup {job['name']}", "", "[Service]", "Type=oneshot", f"ExecStart={SCRIPT_PATH} run {job['id']}", ""])
        write_unit(unit_name(job["id"], "service"), service)
        timer_path = UNIT_DIRECTORY / unit_name(job["id"], "timer")
        if job["enabled"]:
            timer = "\n".join(["[Unit]", f"Description=Scheduled Cockpit Apps backup {job['name']}", "", "[Timer]", f"OnCalendar={job['onCalendar'].strip()}", "Persistent=true", f"Unit={unit_name(job['id'], 'service')}", "", "[Install]", "WantedBy=timers.target", ""])
            write_unit(timer_path.name, timer)
        else:
            subprocess.run(["systemctl", "disable", "--now", timer_path.name], capture_output=True)
            timer_path.unlink(missing_ok=True)
    for path in UNIT_DIRECTORY.glob(f"{PREFIX}@*.timer"):
        job_id = path.name[len(PREFIX) + 1:-6]
        if job_id not in expected:
            subprocess.run(["systemctl", "disable", "--now", path.name], capture_output=True); path.unlink()
            (UNIT_DIRECTORY / unit_name(job_id, "service")).unlink(missing_ok=True); log_path(job_id).unlink(missing_ok=True)
    subprocess.run(["systemctl", "daemon-reload"], check=True, capture_output=True)
    for job in items:
        if job["enabled"]: subprocess.run(["systemctl", "enable", "--now", unit_name(job["id"], "timer")], check=True, capture_output=True)

def zfs_dataset(path):
    result = subprocess.run(["findmnt", "--json", "--target", path, "--output", "FSTYPE,SOURCE"], check=True, text=True, capture_output=True)
    filesystem = json.loads(result.stdout).get("filesystems", [{}])[0]
    return filesystem.get("source") if filesystem.get("fstype") == "zfs" else None

def snapshot(dataset, job_id, retention):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    prefix = f"{dataset}@backup-{job_id}-"
    subprocess.run(["zfs", "snapshot", f"{prefix}{stamp}"], check=True, capture_output=True)
    result = subprocess.run(["zfs", "list", "-H", "-t", "snapshot", "-o", "name", "-s", "creation", "-r", dataset], check=True, text=True, capture_output=True)
    snapshots = [name for name in result.stdout.splitlines() if name.startswith(prefix)]
    for old in snapshots[:-retention] if retention else []: subprocess.run(["zfs", "destroy", old], check=True, capture_output=True)
    return len(snapshots[-retention:] if retention else snapshots)

def run_job(job_id):
    items = jobs(); job = next((item for item in items if item.get("id") == job_id), None)
    if not job: raise ValueError("Backup não encontrado.")
    validate(job)
    source, destination = os.path.realpath(job["source"]), os.path.realpath(job["destination"])
    if not os.path.isdir(source): raise ValueError("A origem deve ser um diretório existente.")
    if source == destination or destination.startswith(source.rstrip("/") + "/"): raise ValueError("O destino não pode ser a origem ou estar dentro dela.")
    with (cache_directory() / f"{job_id}.lock").open("w") as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {"skipped": True, "message": "O backup já está em execução."}
        started = datetime.datetime.now(datetime.timezone.utc)
        try:
            os.makedirs(destination, exist_ok=True); snapshots = 0
            for path, enabled in ((source, job["snapshotSource"]), (destination, job["snapshotDestination"])):
                if enabled:
                    dataset = zfs_dataset(path)
                    if not dataset: raise ValueError(f"Snapshot solicitado, mas {path} não está em ZFS.")
                    snapshots += snapshot(dataset, job_id, job["snapshotRetention"])
            result = subprocess.run(["rsync", "-aHAX", "--numeric-ids", "--stats", "--itemize-changes", source.rstrip("/") + "/", destination.rstrip("/") + "/"], check=True, capture_output=True, text=True)
            write_log(job_id, result.stdout); job["lastRun"] = {"status": "success", "at": started.isoformat(), "durationSeconds": round((datetime.datetime.now(datetime.timezone.utc) - started).total_seconds()), "metrics": {"snapshots": snapshots}}
            save_jobs(items); return {"source": source, "destination": destination}
        except Exception as error:
            job["lastRun"] = {"status": "error", "at": started.isoformat(), "error": str(error)}; save_jobs(items); write_log(job_id, f"Falhou: {error}"); raise

def status(job_id):
    result = subprocess.run(["systemctl", "show", unit_name(job_id, "service"), "--property=ActiveState,Result"], text=True, capture_output=True)
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    return {"running": values.get("ActiveState") in ("active", "activating"), "result": values.get("Result", "unknown")}

def output(value): print(json.dumps({"ok": True, **value}))
def main():
    try:
        action = sys.argv[1]
        if action == "list":
            items = jobs()
            for job in items: job["status"] = status(job["id"])
            output({"jobs": items})
        elif action == "save":
            job = json.load(sys.stdin); validate(job); items = [item for item in jobs() if item.get("id") != job["id"]] + [job]; save_jobs(items); sync_systemd(items); output({})
        elif action == "delete":
            items = [item for item in jobs() if item.get("id") != sys.argv[2]]; save_jobs(items); sync_systemd(items); output({})
        elif action == "start": subprocess.run(["systemctl", "start", "--no-block", unit_name(sys.argv[2], "service")], check=True, capture_output=True); output({"started": True})
        elif action == "logs":
            job_id = sys.argv[2]; lines = log_path(job_id).read_text(encoding="utf-8").splitlines()[-50:] if log_path(job_id).exists() else []
            journal = subprocess.run(["journalctl", "--no-pager", "--output=short-iso", "--lines=50", "--unit", unit_name(job_id, "service")], text=True, capture_output=True).stdout.splitlines()
            output({"lines": lines, "journal": journal})
        elif action == "run": output(run_job(sys.argv[2]))
        else: raise ValueError("Ação inválida.")
    except Exception as error: print(json.dumps({"ok": False, "error": str(error)})); return 1
    return 0
if __name__ == "__main__": sys.exit(main())
