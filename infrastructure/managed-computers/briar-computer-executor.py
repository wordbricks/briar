#!/usr/bin/python3
"""Execute one bounded Briar Computer Use request against the current X display."""

import base64
import io
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from PIL import Image
from Xlib import X, XK, display
from Xlib.ext import xtest


MAX_ACTIONS = 11  # Ten model actions plus the host-appended final screenshot.
MAX_WAIT_MS = 30_000
BUTTONS = {"left": 1, "middle": 2, "right": 3, "back": 8, "forward": 9}
SCROLL_BUTTONS = {"up": 4, "down": 5, "left": 6, "right": 7}
KEY_ALIASES = {
    "alt": "Alt_L",
    "backspace": "BackSpace",
    "cmd": "Super_L",
    "command": "Super_L",
    "control": "Control_L",
    "ctrl": "Control_L",
    "delete": "Delete",
    "down": "Down",
    "end": "End",
    "enter": "Return",
    "esc": "Escape",
    "escape": "Escape",
    "home": "Home",
    "left": "Left",
    "meta": "Super_L",
    "pagedown": "Next",
    "pageup": "Prior",
    "return": "Return",
    "right": "Right",
    "shift": "Shift_L",
    "space": "space",
    "super": "Super_L",
    "tab": "Tab",
    "up": "Up",
}


class RequestError(Exception):
    pass


def require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestError(f"{label} must be an object")
    return value


def require_int(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RequestError(f"{label} must be an integer")
    if value < minimum or value > maximum:
        raise RequestError(f"{label} must be between {minimum} and {maximum}")
    return value


def require_string(value: Any, label: str, maximum: int = 1_000_000) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise RequestError(f"{label} must be a string of at most {maximum} characters")
    return value


class XComputer:
    def __init__(self, bind_unmapped_characters: bool) -> None:
        self.display = display.Display()
        self.root = self.display.screen().root
        geometry = self.root.get_geometry()
        self.width = geometry.width
        self.height = geometry.height
        self.bind_unmapped_characters = bind_unmapped_characters
        self.dynamic_keycode = 255

    def close(self) -> None:
        self.display.sync()
        self.display.close()

    def point(self, action: dict[str, Any], optional: bool = False) -> tuple[int, int] | None:
        if optional and action.get("x") is None and action.get("y") is None:
            return None
        x = require_int(action.get("x"), "x", 0, self.width - 1)
        y = require_int(action.get("y"), "y", 0, self.height - 1)
        return (x, y)

    def move(self, x: int, y: int) -> None:
        xtest.fake_input(self.display, X.MotionNotify, x=x, y=y)
        self.display.sync()

    def button(self, button: int, down: bool) -> None:
        xtest.fake_input(
            self.display,
            X.ButtonPress if down else X.ButtonRelease,
            button,
        )
        self.display.sync()

    def click(self, button: int, count: int = 1) -> None:
        for _ in range(count):
            self.button(button, True)
            self.button(button, False)
            time.sleep(0.04)

    def keysym(self, name: str) -> int:
        normalized = KEY_ALIASES.get(name.strip().lower(), name.strip())
        symbol = XK.string_to_keysym(normalized)
        if symbol == X.NoSymbol and len(normalized) == 1:
            symbol = ord(normalized)
        if symbol == X.NoSymbol:
            raise RequestError(f"Unknown key: {name}")
        return symbol

    def modifier_for_index(self, index: int) -> list[int]:
        modifiers: list[int] = []
        if index % 2 == 1:
            modifiers.append(self.keysym("Shift_L"))
        if index >= 2:
            modifiers.append(self.keysym("ISO_Level3_Shift"))
        return modifiers

    def mapped_key(self, symbol: int) -> tuple[int, list[int]] | None:
        mappings = list(self.display.keysym_to_keycodes(symbol))
        if not mappings:
            return None
        keycode, index = mappings[0]
        return (keycode, self.modifier_for_index(index))

    def key_event(self, keycode: int, down: bool) -> None:
        xtest.fake_input(
            self.display,
            X.KeyPress if down else X.KeyRelease,
            keycode,
        )

    def press_symbol(self, symbol: int, hold_ms: int = 0) -> None:
        mapped = self.mapped_key(symbol)
        if mapped is not None:
            keycode, modifiers = mapped
            modifier_codes = [self.display.keysym_to_keycode(value) for value in modifiers]
            for code in modifier_codes:
                self.key_event(code, True)
            self.key_event(keycode, True)
            self.display.sync()
            if hold_ms:
                time.sleep(hold_ms / 1000)
            self.key_event(keycode, False)
            for code in reversed(modifier_codes):
                self.key_event(code, False)
            self.display.sync()
            return
        if not self.bind_unmapped_characters:
            raise RequestError("Character is not mapped by the current keyboard layout")
        previous = self.display.get_keyboard_mapping(self.dynamic_keycode, 1)
        width = len(previous[0])
        replacement = tuple([symbol] + [X.NoSymbol] * (width - 1))
        try:
            self.display.change_keyboard_mapping(self.dynamic_keycode, [replacement])
            self.display.sync()
            self.key_event(self.dynamic_keycode, True)
            self.key_event(self.dynamic_keycode, False)
            self.display.sync()
        finally:
            self.display.change_keyboard_mapping(self.dynamic_keycode, previous)
            self.display.sync()

    def press_combo(self, expression: str, hold_ms: int = 0) -> None:
        names = [part.strip() for part in expression.split("+") if part.strip()]
        if not names:
            raise RequestError("key must not be empty")
        pressed: list[int] = []
        try:
            for name in names:
                mapped = self.mapped_key(self.keysym(name))
                if mapped is None:
                    raise RequestError(f"Key is not mapped: {name}")
                keycode, implicit_modifiers = mapped
                for modifier in implicit_modifiers:
                    modifier_code = self.display.keysym_to_keycode(modifier)
                    if modifier_code not in pressed:
                        self.key_event(modifier_code, True)
                        pressed.append(modifier_code)
                self.key_event(keycode, True)
                pressed.append(keycode)
            self.display.sync()
            if hold_ms:
                time.sleep(hold_ms / 1000)
        finally:
            for keycode in reversed(pressed):
                self.key_event(keycode, False)
            self.display.sync()

    def type_text(self, text: str) -> None:
        for character in text:
            if character in ("\n", "\r"):
                symbol = self.keysym("Return")
            elif character == "\t":
                symbol = self.keysym("Tab")
            else:
                symbol = XK.string_to_keysym(character)
                if symbol == X.NoSymbol:
                    symbol = 0x01000000 | ord(character)
            self.press_symbol(symbol)
            time.sleep(0.008)

    def modifiers(self, expression: Any) -> list[int]:
        if expression is None or expression == "":
            return []
        text = require_string(expression, "modifierKeys", 128)
        codes: list[int] = []
        for name in re.split(r"[+,]", text):
            if not name.strip():
                continue
            mapped = self.mapped_key(self.keysym(name))
            if mapped is None:
                raise RequestError(f"Modifier is not mapped: {name}")
            codes.append(mapped[0])
        return codes

    def with_modifiers(self, expression: Any, operation: Any) -> None:
        codes = self.modifiers(expression)
        try:
            for code in codes:
                self.key_event(code, True)
            self.display.sync()
            operation()
        finally:
            for code in reversed(codes):
                self.key_event(code, False)
            self.display.sync()

    def cursor(self) -> dict[str, int]:
        pointer = self.root.query_pointer()
        return {"x": pointer.root_x, "y": pointer.root_y}

    def screenshot(self, directory: Path, tool_call_id: str) -> tuple[str, str]:
        image_data = self.root.get_image(
            0,
            0,
            self.width,
            self.height,
            X.ZPixmap,
            0xFFFFFFFF,
        )
        image = Image.frombytes(
            "RGB",
            (self.width, self.height),
            image_data.data,
            "raw",
            "BGRX",
        )
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        png = output.getvalue()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.chmod(0o700)
        safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", tool_call_id)[:64] or "computer"
        path = directory / f"{safe_id}-{uuid.uuid4().hex}.png"
        with path.open("xb") as screenshot_file:
            os.chmod(path, 0o600)
            screenshot_file.write(png)
        return (base64.b64encode(png).decode("ascii"), str(path))


def execute_action(computer: XComputer, action: dict[str, Any]) -> None:
    action_type = require_string(action.get("type"), "action.type", 32)
    if action_type == "mouse_move":
        point = computer.point(action)
        assert point is not None
        computer.move(*point)
    elif action_type == "click":
        point = computer.point(action, optional=True)
        if point is not None:
            computer.move(*point)
        button = BUTTONS.get(require_string(action.get("button"), "button", 16))
        if button is None:
            raise RequestError("Unknown mouse button")
        count = require_int(action.get("count"), "count", 1, 3)
        computer.with_modifiers(
            action.get("modifierKeys"),
            lambda: computer.click(button, count),
        )
    elif action_type in ("mouse_down", "mouse_up"):
        button = BUTTONS.get(require_string(action.get("button"), "button", 16))
        if button is None:
            raise RequestError("Unknown mouse button")
        computer.button(button, action_type == "mouse_down")
    elif action_type == "drag":
        raw_path = action.get("path")
        if not isinstance(raw_path, list) or not 2 <= len(raw_path) <= 100:
            raise RequestError("drag.path must contain between 2 and 100 points")
        path = [computer.point(require_dict(point, "drag.path point")) for point in raw_path]
        button = BUTTONS.get(require_string(action.get("button"), "button", 16))
        if button is None:
            raise RequestError("Unknown mouse button")

        def drag() -> None:
            first = path[0]
            assert first is not None
            computer.move(*first)
            computer.button(button, True)
            try:
                for point in path[1:]:
                    assert point is not None
                    computer.move(*point)
                    time.sleep(0.02)
            finally:
                computer.button(button, False)

        computer.with_modifiers(action.get("modifierKeys"), drag)
    elif action_type == "scroll":
        point = computer.point(action, optional=True)
        if point is not None:
            computer.move(*point)
        direction = require_string(action.get("direction"), "direction", 16)
        button = SCROLL_BUTTONS.get(direction)
        if button is None:
            raise RequestError("Unknown scroll direction")
        amount = require_int(action.get("amount"), "amount", 1, 100)
        computer.with_modifiers(
            action.get("modifierKeys"),
            lambda: computer.click(button, amount),
        )
    elif action_type == "type":
        computer.type_text(require_string(action.get("text"), "text"))
    elif action_type == "key":
        hold_ms = action.get("holdDurationMs")
        if hold_ms is None:
            hold_ms = 0
        computer.press_combo(
            require_string(action.get("key"), "key", 128),
            require_int(hold_ms, "holdDurationMs", 0, MAX_WAIT_MS),
        )
    elif action_type == "wait":
        duration_ms = require_int(action.get("durationMs"), "durationMs", 0, MAX_WAIT_MS)
        time.sleep(duration_ms / 1000)
    elif action_type in ("screenshot", "cursor_position"):
        return
    else:
        raise RequestError(f"Unknown Computer Use action: {action_type}")


def run(request: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    action_count = 0
    computer: XComputer | None = None
    screenshot: str | None = None
    screenshot_path: str | None = None
    action_names: list[str] = []
    try:
        display_index = require_int(request.get("displayIndex"), "displayIndex", 2, 100)
        expected_display = f":{display_index}"
        if os.environ.get("DISPLAY") != expected_display:
            raise RequestError("DISPLAY does not match displayIndex")
        raw_actions = request.get("actions")
        if not isinstance(raw_actions, list) or not 1 <= len(raw_actions) <= MAX_ACTIONS:
            raise RequestError(f"actions must contain between 1 and {MAX_ACTIONS} items")
        bind_unmapped = request.get("bindUnmappedCharacters")
        if not isinstance(bind_unmapped, bool):
            raise RequestError("bindUnmappedCharacters must be a boolean")
        directory = Path(require_string(request.get("screenshotDirectory"), "screenshotDirectory", 4096))
        if not directory.is_absolute():
            raise RequestError("screenshotDirectory must be absolute")
        tool_call_id = require_string(request.get("toolCallId"), "toolCallId", 256)
        computer = XComputer(bind_unmapped)
        for raw_action in raw_actions:
            action = require_dict(raw_action, "action")
            action_names.append(require_string(action.get("type"), "action.type", 32))
            execute_action(computer, action)
            action_count += 1
        screenshot, screenshot_path = computer.screenshot(directory, tool_call_id)
        return {
            "success": True,
            "actionCount": action_count,
            "durationMs": round((time.monotonic() - started) * 1000),
            "screenshot": screenshot,
            "screenshotPath": screenshot_path,
            "cursorPosition": computer.cursor(),
            "log": f"executed {', '.join(action_names)}",
        }
    except Exception as error:  # The RPC result carries action-level failures.
        if computer is not None:
            try:
                directory_value = request.get("screenshotDirectory")
                tool_call_value = request.get("toolCallId")
                if isinstance(directory_value, str) and isinstance(tool_call_value, str):
                    screenshot, screenshot_path = computer.screenshot(
                        Path(directory_value),
                        tool_call_value,
                    )
            except Exception:
                pass
        result: dict[str, Any] = {
            "success": False,
            "error": str(error) or error.__class__.__name__,
            "actionCount": action_count,
            "durationMs": round((time.monotonic() - started) * 1000),
            "log": f"failed after {action_count} actions",
        }
        if screenshot is not None:
            result["screenshot"] = screenshot
        if screenshot_path is not None:
            result["screenshotPath"] = screenshot_path
        return result
    finally:
        if computer is not None:
            computer.close()


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise RequestError("request exceeds 16 MiB")
        request = require_dict(json.loads(raw), "request")
        json.dump(run(request), sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
        return 0
    except Exception as error:
        print(str(error) or error.__class__.__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
