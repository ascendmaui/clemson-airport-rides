#!/usr/bin/env python3
"""Drive `eas credentials` for an existing APNs .p8. Never runs a build."""

from __future__ import annotations

import argparse
import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")
DOWN = "\x1b[B"

# development, preview, production. The simulator profile cannot set a push key.
PRODUCTION_MOVES = 2
# Build credentials is first. Push Notifications is the next row.
PUSH_MENU_MOVES = 1
# Set up is first. Add a new push key is the next row.
ADD_KEY_MOVES = 1
# Go back is the last push-key row.
BACK_MOVES = 4
# Exit is the last high-level row.
EXIT_MOVES = 5


def strip_ansi(text: str) -> str:
    return ANSI.sub("", text)


def initial_state() -> dict:
    return {"phase": "profile", "pending": "", "assigned": False, "replies": []}


def _down(count: int) -> str:
    return (DOWN * count) + "\r"


def next_reply(state: dict, chunk: str, p8: str, key_id: str, team_id: str) -> str | None:
    """Return the next keystrokes for new terminal text, or None while waiting."""
    state["pending"] += strip_ansi(chunk)
    text = state["pending"]
    phase = state["phase"]
    reply = None
    if "Push Key assigned to" in text:
        state["assigned"] = True
    if phase == "profile" and "Which build profile do you want to configure?" in text:
        reply, state["phase"] = _down(PRODUCTION_MOVES), "apple_or_menu"
    elif phase == "apple_or_menu" and "log in to your Apple account?" in text:
        reply, state["phase"] = "n\r", "menu_push"
    elif phase in {"apple_or_menu", "menu_push"} and "What do you want to do?" in text:
        reply, state["phase"] = _down(PUSH_MENU_MOVES), "menu_add"
    elif phase == "menu_add" and "What do you want to do?" in text:
        reply, state["phase"] = _down(ADD_KEY_MOVES), "generate"
    elif phase == "generate" and "Generate a new Apple Push Notifications service key?" in text:
        reply, state["phase"] = "n\r", "p8"
    elif phase == "p8" and "Path to P8 file:" in text:
        reply, state["phase"] = p8 + "\r", "key"
    elif phase == "key" and "Key ID:" in text:
        reply, state["phase"] = key_id + "\r", "team"
    elif phase == "team" and "Apple Team ID:" in text:
        reply, state["phase"] = "\x15" + team_id + "\r", "assign"
    elif phase == "assign" and "Proceed anyway?" in text:
        reply = "y\r"
    elif phase == "assign" and "use the new Push Key?" in text:
        reply, state["phase"] = "y\r", "keypress"
    elif phase == "keypress" and "Press any key to continue" in text:
        reply, state["phase"] = "\r", "menu_back"
    elif phase == "menu_back" and "What do you want to do?" in text:
        reply, state["phase"] = _down(BACK_MOVES), "menu_exit"
    elif phase == "menu_exit" and "What do you want to do?" in text:
        reply, state["phase"] = _down(EXIT_MOVES), "done"
    if reply is None:
        return None
    state["replies"].append(reply)
    state["pending"] = ""
    return reply


def self_test() -> int:
    state = initial_state()
    script = [
        ("Which build profile do you want to configure?", _down(PRODUCTION_MOVES)),
        ("Do you want to log in to your Apple account?", "n\r"),
        ("What do you want to do?", _down(PUSH_MENU_MOVES)),
        ("What do you want to do?", _down(ADD_KEY_MOVES)),
        ("Generate a new Apple Push Notifications service key?", "n\r"),
        ("Path to P8 file:", "/tmp/AuthKey.p8\r"),
        ("Key ID:", "AB12CD34EF\r"),
        ("Apple Team ID:", "\x15L85AF3V872\r"),
        ("Push Key ID AB12CD34EF could not be found on Apple's servers. Proceed anyway?", "y\r"),
        ("Do you want clemson-rides-rider to use the new Push Key?", "y\r"),
        ("Push Key assigned to clemson-rides-rider: com.ascendmaui.clemsonrides.rider\nPress any key to continue...", "\r"),
        ("What do you want to do?", _down(BACK_MOVES)),
        ("What do you want to do?", _down(EXIT_MOVES)),
    ]
    for chunk, expected in script:
        got = next_reply(state, chunk, "/tmp/AuthKey.p8", "AB12CD34EF", "L85AF3V872")
        if got != expected:
            print(f"prompt mismatch\n chunk={chunk!r}\n got={got!r}\n expected={expected!r}", file=sys.stderr)
            return 1
    if not state["assigned"] or state["phase"] != "done":
        print(f"incomplete state {state['phase']} assigned={state['assigned']}", file=sys.stderr)
        return 1
    if any("eas build" in reply or "prebuild" in reply for reply in state["replies"]):
        print("self-test emitted a build command", file=sys.stderr)
        return 1
    print("apns prompt self-test ok")
    return 0


def drive(app_dir: str, p8: str, key_id: str, team_id: str, eas: list[str], timeout_s: float) -> int:
    if any(part == "build" or part.startswith("build") for part in eas):
        print("refusing to run an EAS build", file=sys.stderr)
        return 2
    command = [*eas, "credentials", "--platform", "ios"]
    if "build" in command or "prebuild" in command:
        print("refusing to run an EAS build or prebuild", file=sys.stderr)
        return 2
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(app_dir)
        os.execvp(command[0], command)
        return 127
    state = initial_state()
    deadline = time.monotonic() + timeout_s
    collected = ""
    try:
        while True:
            if time.monotonic() > deadline:
                print("eas credentials timed out before the push key was assigned", file=sys.stderr)
                return 1
            ready, _, _ = select.select([fd], [], [], 1)
            if not ready:
                finished, status = os.waitpid(pid, os.WNOHANG)
                if finished:
                    return 0 if state["assigned"] and os.waitstatus_to_exitcode(status) == 0 else 1
                continue
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b""
            if not chunk:
                _, status = os.waitpid(pid, 0)
                code = os.waitstatus_to_exitcode(status)
                sys.stdout.write(collected)
                if state["assigned"] and code == 0:
                    return 0
                print("eas credentials finished without assigning the push key", file=sys.stderr)
                return code or 1
            text = chunk.decode("utf-8", errors="replace")
            collected += text
            sys.stdout.write(text)
            sys.stdout.flush()
            reply = next_reply(state, text, p8, key_id, team_id)
            if reply:
                os.write(fd, reply.encode())
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    parser = argparse.ArgumentParser(description="Upload an APNs .p8 with eas credentials")
    parser.add_argument("--app-dir", required=True)
    parser.add_argument("--p8", required=True)
    parser.add_argument("--key-id", required=True)
    parser.add_argument("--team-id", required=True)
    parser.add_argument("--eas", required=True, help="EAS executable, extra args separated by |")
    parser.add_argument("--timeout", type=float, default=180)
    args = parser.parse_args()
    eas = [part for part in args.eas.split("|") if part]
    return drive(args.app_dir, args.p8, args.key_id, args.team_id, eas, args.timeout)


if __name__ == "__main__":
    sys.exit(main())
