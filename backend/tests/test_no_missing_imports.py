"""Every module must import the names it uses.

Python raises NameError at CALL time, not import time, so a missing `import
json` used only inside one function sits silently until someone hits that
endpoint -- and `import main` succeeds the whole while. That is exactly how
services/audit.py shipped without `import json` and turned POST /expenses
into a 500.

The regex-based scanner that generated those imports missed it because the
usage was inside a triple-quoted f-string, which the scanner stripped as a
docstring before looking for identifiers. This check parses the AST instead,
so no string form can hide a reference.
"""
import ast
import io
import os

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"venv", "__pycache__", ".git", "tests", "db"}

# Names that must be imported to be used. Deliberately the standard-library
# modules this codebase actually reaches for -- a broader list would start
# flagging builtins and locals for no benefit.
MUST_BE_IMPORTED = {
    "json", "uuid", "os", "re", "io", "time", "base64", "logging", "hashlib",
    "hmac", "secrets", "asyncio", "datetime", "Path", "PyPDF2", "statistics",
}


def _python_files():
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(root, name)


def _bound_names(tree):
    """Everything the module binds: imports, defs, assignments, parameters."""
    bound = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bound.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            bound.add(node.id)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.alias):
            bound.add(alias_name(node))
    return bound


def alias_name(alias):
    return (alias.asname or alias.name).split(".")[0]


@pytest.mark.parametrize("path", sorted(_python_files()),
                         ids=lambda p: os.path.relpath(p, BACKEND).replace("\\", "/"))
def test_module_imports_everything_it_uses(path):
    source = io.open(path, encoding="utf-8").read()
    tree = ast.parse(source, filename=path)

    bound = _bound_names(tree)
    used = {n.id for n in ast.walk(tree)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}

    missing = sorted((used & MUST_BE_IMPORTED) - bound)
    assert not missing, (
        f"{os.path.relpath(path, BACKEND)} uses {', '.join(missing)} "
        "without importing it -- a NameError waiting on whichever request "
        "reaches that line"
    )


def test_every_module_parses():
    """A syntax error in a router only surfaces when something imports it."""
    for path in _python_files():
        source = io.open(path, encoding="utf-8").read()
        ast.parse(source, filename=path)
