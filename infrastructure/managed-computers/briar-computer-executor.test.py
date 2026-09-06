"""Unit tests for the pure helpers in briar-computer-executor.py.

Run with: python3 infrastructure/managed-computers/briar-computer-executor.test.py
"""

import importlib.util
import pathlib
import sys
import types
import unittest

EXECUTOR = pathlib.Path(__file__).with_name("briar-computer-executor.py")


def load_executor() -> types.ModuleType:
    # The executor imports python-xlib and Pillow at module load; stub them so
    # the pure helpers can be tested on machines without an X server.
    for name in (
        "Xlib", "Xlib.X", "Xlib.XK", "Xlib.display", "Xlib.ext", "Xlib.ext.xtest",
        "PIL", "PIL.Image",
    ):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["PIL"].Image = sys.modules["PIL.Image"]
    xlib = sys.modules["Xlib"]
    xlib.X = sys.modules["Xlib.X"]
    xlib.XK = sys.modules["Xlib.XK"]
    xlib.display = sys.modules["Xlib.display"]
    sys.modules["Xlib.ext"].xtest = sys.modules["Xlib.ext.xtest"]
    spec = importlib.util.spec_from_file_location("briar_computer_executor", EXECUTOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ComboKeyNamesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.executor = load_executor()

    def test_letters_in_a_combo_are_unshifted(self) -> None:
        # Uppercase letter keysyms live on the Shift level, so keeping the
        # case would hold Shift and turn ctrl+A into Chromium's Ctrl+Shift+A.
        self.assertEqual(self.executor.combo_key_names("CTRL+A"), ["CTRL", "a"])
        self.assertEqual(self.executor.combo_key_names("ctrl+L"), ["ctrl", "l"])

    def test_shift_is_only_held_when_named(self) -> None:
        self.assertEqual(
            self.executor.combo_key_names("ctrl+shift+T"),
            ["ctrl", "shift", "t"],
        )

    def test_a_lone_key_keeps_its_case(self) -> None:
        self.assertEqual(self.executor.combo_key_names("A"), ["A"])
        self.assertEqual(self.executor.combo_key_names("Return"), ["Return"])

    def test_named_keys_and_whitespace(self) -> None:
        self.assertEqual(
            self.executor.combo_key_names(" ctrl + BackSpace "),
            ["ctrl", "BackSpace"],
        )
        self.assertEqual(self.executor.combo_key_names("ctrl+F5"), ["ctrl", "F5"])
        self.assertEqual(self.executor.combo_key_names(""), [])


if __name__ == "__main__":
    unittest.main()
