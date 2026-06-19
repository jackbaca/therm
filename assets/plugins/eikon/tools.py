"""Handlers for the eikon plugin."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _json(data: dict[str, Any]) -> str:
    return json.dumps(data)


def _herm_bin() -> str | None:
    override = os.getenv("HERM_EIKON_HERM_BIN", "").strip()
    if override:
        return override
    return shutil.which("herm")


def check_herm_available() -> bool:
    binary = _herm_bin()
    if not binary:
        return False
    if os.path.sep in binary:
        return Path(binary).is_file() and os.access(binary, os.X_OK)
    return shutil.which(binary) is not None


def _run(parts: list[str], label: str, timeout: int = 120) -> dict[str, Any]:
    binary = _herm_bin()
    if not binary:
        return {"ok": False, "error": "herm executable not found on PATH"}

    try:
        proc = subprocess.run([binary, *parts], capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError:
        return {"ok": False, "error": f"herm executable not found: {binary}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"herm eikon {label} timed out"}

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        return {"ok": False, "error": f"herm eikon {label} failed: {detail}"}

    line = next((ln for ln in reversed(stdout.splitlines()) if ln.strip()), "")
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"herm eikon {label} returned non-JSON output", "output": stdout}
    if isinstance(payload, dict):
        return payload
    return {"ok": True, "result": payload}


def _name(args: dict[str, Any]) -> str:
    return str(args.get("name") or "").strip()


def _handle_eikon_install(args: dict[str, Any], **_: Any) -> str:
    source = str(args.get("source") or "").strip()
    if not source:
        return _json({"ok": False, "error": "source is required"})

    cmd = ["eikon", "install", source, "--json"]
    name = _name(args)
    if name:
        cmd.extend(["--name", name])
    if args.get("media") is False or args.get("no_source") is True:
        cmd.append("--no-source")
    if args.get("active_ok") is True:
        cmd.append("--active-ok")

    payload = _run(cmd, "install")
    if not payload.get("ok") or args.get("set_active") is False:
        return _json(payload)

    active = _run(["eikon", "use", str(payload.get("name") or source), "--json"], "use")
    if not active.get("ok"):
        return _json({"ok": False, "installed": payload, "error": f"installed but activation failed: {active.get('error', 'unknown error')}"})
    return _json({**payload, "active": active.get("active")})


def _handle_eikon_search(args: dict[str, Any], **_: Any) -> str:
    query = str(args.get("query") or "").strip()
    cmd = ["eikon", "search"]
    if query:
        cmd.append(query)
    return _json(_run([*cmd, "--json"], "search"))


def _handle_eikon_list(args: dict[str, Any], **_: Any) -> str:
    return _json(_run(["eikon", "list", "--json"], "list"))


def _handle_eikon_use(args: dict[str, Any], **_: Any) -> str:
    name = _name(args)
    if not name:
        return _json({"ok": False, "error": "name is required"})
    return _json(_run(["eikon", "use", name, "--json"], "use"))


def _handle_eikon_update(args: dict[str, Any], **_: Any) -> str:
    name = _name(args)
    if not name:
        return _json({"ok": False, "error": "name is required"})
    cmd = ["eikon", "update", name, "--json"]
    if args.get("active_ok") is True:
        cmd.append("--active-ok")
    return _json(_run(cmd, "update"))


def _handle_eikon_remove(args: dict[str, Any], **_: Any) -> str:
    name = _name(args)
    if not name:
        return _json({"ok": False, "error": "name is required"})
    cmd = ["eikon", "remove", name, "--json"]
    if args.get("active_ok") is True:
        cmd.append("--active-ok")
    return _json(_run(cmd, "remove"))
