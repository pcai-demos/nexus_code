"""py_doc_check.py: the documentation check of one Python module against the Code Documentation Standard (STD-DOC).

S6 (the owner's S6-D3 (a) of 2026-10-13: a tool that reads the Python itself). The NexCODE bridge runs it in the IDE
container with the service's own Python and no shell (extension.js, command py-doc-check). It reads the module's syntax
tree (ast) and its comments (tokenize); it never imports or runs the module.

What a tool can verify, it verifies (Nexus_DOC_Code-Documentation-Standard_v1.md):
  DOC-001  the header: the module's docstring carries every field of the team's template (CLR-WIKI-024 C1): MODULE,
           PURPOSE, SERVICE, OWNER, CLASSIFICATION, the copyright line naming Nexus Bank plc, the trade mark line,
           HISTORY, REQUIREMENTS and AI-ASSISTED, each label in capitals at the start of its line;
  DOC-002  every class, function and method carries a docstring, or a comment directly above or below the line that
           opens it;
  DOC-004  no card number (13 to 19 digits, the first 2 to 6, that pass the Luhn check) in a comment or a docstring;
  DOC-005  no commented-out code: a comment line, or a block of them, that parses as a Python statement (an assignment,
           a call, a return ...); a tool directive (noqa, type:, pragma) is not code;
  DOC-006  money logic carries its requirement: a function that builds a Decimal or rounds one (quantize) names a money
           requirement in its docstring, or in a comment inside it or directly above: PAY-010 to PAY-015 or PAY-020 (the
           Payments Engineering Standard's money rules; PAY-030 and PAY-031 are audit events), FIN-POL-003 or ADR-004;
  DOC-007  the header's AI-ASSISTED field names the assistant (NexCODE);
  DOC-008  only with --before-stdin (the module as it was given to a comments-only change, read from standard input):
           no line of code changed: the two syntax trees are identical once docstrings, comments and `pass` are set
           aside.
DOC-003 (comments agree with the code) is judgement, not a tool's: the reviewer and the explanation carry it.

Usage: python3 -I py_doc_check.py --path <module.py> [--before-stdin]
Prints one line: "NEXCODE-PY-DOC-CHECK " and the result as JSON. Exit code 0 passed, 1 failed, 2 not checked.
"""

import argparse
import ast
import io
import json
import re
import sys
import textwrap
import tokenize
import warnings

MARK = "NEXCODE-PY-DOC-CHECK "
MAX_BYTES = 1024 * 1024

# DOC-001's fields, as the team's Python template (CLR-WIKI-024) labels them.
HEADER_FIELDS = [
    ("module", "MODULE", re.compile(r"^[ \t]*MODULE[ \t]*:\s*\S", re.M)),
    ("purpose", "PURPOSE", re.compile(r"^[ \t]*PURPOSE[ \t]*:\s*\S", re.M)),
    ("service", "SERVICE", re.compile(r"^[ \t]*SERVICE[ \t]*:\s*\S", re.M)),
    ("owner", "OWNER", re.compile(r"^[ \t]*OWNER[ \t]*:\s*\S", re.M)),
    ("classification", "CLASSIFICATION", re.compile(r"^[ \t]*CLASSIFICATION[ \t]*:\s*\S", re.M)),
    ("notice", "the copyright line naming Nexus Bank plc", re.compile(r"\bcopyright\b[^\n]*\bNexus Bank plc\b", re.I)),
    ("tradeMark", "the trade mark line", re.compile(r"\btrade ?marks?\b", re.I)),
    ("history", "HISTORY", re.compile(r"^[ \t]*HISTORY[ \t]*:\s*\S", re.M)),
    ("requirements", "REQUIREMENTS", re.compile(r"^[ \t]*REQUIREMENTS[ \t]*:\s*\S", re.M)),
    ("aiAssisted", "AI-ASSISTED", re.compile(r"^[ \t]*AI-ASSISTED[ \t]*:\s*\S", re.M)),
]
LABEL_LINE = re.compile(r"^[ \t]*[A-Z][A-Z-]*[ \t]*:")
MONEY_REQUIREMENT = re.compile(r"\b(?:PAY-01[0-5]|PAY-020|FIN-POL-003|ADR-004)\b")
CARD_RUN = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
DIRECTIVE = re.compile(r"^#\s*(?:type:|noqa\b|pragma\b|pylint:|fmt:|isort:|mypy:|-\*-|!)", re.I)
UNIT_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
CODE_STATEMENTS = tuple(
    t
    for t in (
        ast.Assign, ast.AugAssign, ast.Return, ast.Import, ast.ImportFrom, ast.Raise, ast.Delete, ast.Assert,
        ast.Global, ast.Nonlocal, ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith, ast.Try,
        getattr(ast, "TryStar", None), getattr(ast, "Match", None), ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
    )
    if t is not None
)


def field_value(header, label):
    """A header field's value, its wrapped lines included: the lines after the label's own, up to a blank line or the next
    label (session-90-s6-instructions: a wrapped AI-ASSISTED value named NexCODE on its second line). None when absent."""
    lines = header.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^[ \t]*" + re.escape(label) + r"[ \t]*:[ \t]*(.*)$", line)
        if not m:
            continue
        value = [m.group(1).strip()]
        for nxt in lines[i + 1:]:
            if not nxt.strip() or LABEL_LINE.match(nxt):
                break
            value.append(nxt.strip())
        return " ".join(v for v in value if v)
    return None


def luhn(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def card_numbers(text):
    """The card numbers in a text: 13 to 19 digits (spaces or hyphens between groups) whose first digit is 2 to 6, as
    every PCI DSS payment brand's card's is, and that pass the Luhn check (S6-D10 (a) of 2026-10-13: sixteen zeros pass
    the Luhn check alone)."""
    out = []
    for m in CARD_RUN.finditer(text or ""):
        digits = re.sub(r"[ -]", "", m.group(0))
        if 13 <= len(digits) <= 19 and digits[0] in "23456" and luhn(digits):
            out.append((m.start(), digits))
    return out


def parse(source, name):
    """The module's tree, or (None, "line N: message"). Warnings about the module's own strings are not output."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return ast.parse(source, filename=name), None
        except (SyntaxError, ValueError) as err:
            return None, f"line {getattr(err, 'lineno', None) or '?'}: {getattr(err, 'msg', None) or err}"


def comments_of(source):
    """Every comment: {line: text}, and the lines where a comment stands alone."""
    comments = {}
    alone = set()
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type == tokenize.COMMENT:
                comments[tok.start[0]] = tok.string
                if tok.line.strip().startswith("#"):
                    alone.add(tok.start[0])
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return comments, alone


def units_of(tree):
    """Every class, function and method, with its qualified name, in source order."""
    out = []

    def walk(node, prefix):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, UNIT_TYPES):
                name = prefix + child.name
                out.append((child, name))
                walk(child, name + ".")
            else:
                walk(child, prefix)

    walk(tree, "")
    return out


def first_line(node):
    decorators = [d.lineno for d in getattr(node, "decorator_list", [])]
    return min(decorators + [node.lineno])


def docstring(node):
    try:
        doc = ast.get_docstring(node, clean=False)
    except TypeError:
        return None
    return doc if doc and doc.strip() else None


def documented(node, comments, alone):
    """DOC-002: a docstring, or a comment directly above the line that opens the unit, or on it or directly below it."""
    if docstring(node):
        return True
    if first_line(node) - 1 in alone:
        return True
    body_start = node.body[0].lineno if node.body else node.end_lineno
    return any(line in comments for line in range(node.lineno, max(body_start, node.lineno + 1)))


def own_nodes(fn):
    """The nodes of a function's own code: nested classes and functions left out."""
    stack = list(fn.body)
    while stack:
        node = stack.pop()
        yield node
        for child in ast.iter_child_nodes(node):
            if not isinstance(child, UNIT_TYPES):
                stack.append(child)


def is_money_logic(fn):
    """A function that builds a Decimal or rounds one."""
    for node in own_nodes(fn):
        if isinstance(node, ast.Call):
            f = node.func
            if (isinstance(f, ast.Name) and f.id == "Decimal") or (isinstance(f, ast.Attribute) and f.attr in ("Decimal", "quantize")):
                return True
    return False


def money_tagged(fn, comments):
    if MONEY_REQUIREMENT.search(docstring(fn) or ""):
        return True
    return any(MONEY_REQUIREMENT.search(comments.get(line, "")) for line in range(first_line(fn) - 1, fn.end_lineno + 1))


def looks_like_code(text):
    """True when the text parses as Python with a statement that does something (not a bare word or a label)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            tree = ast.parse(textwrap.dedent(text))
        except (SyntaxError, ValueError):
            return False
    for st in tree.body:
        if isinstance(st, CODE_STATEMENTS):
            return True
        if isinstance(st, ast.AnnAssign) and st.value is not None:
            return True
        if isinstance(st, ast.Expr) and isinstance(st.value, (ast.Call, ast.Await, ast.Yield, ast.YieldFrom)):
            return True
    return False


def commented_out_code(comments, alone):
    """DOC-005: the lines of comments that are code, alone or as a block of consecutive comment lines."""
    lines = sorted(line for line in alone if not DIRECTIVE.match(comments[line]))
    text = {line: re.sub(r"^#[ ]?", "", comments[line]) for line in lines}
    hits = {line for line in lines if looks_like_code(text[line])}
    block = []
    for line in lines + [None]:
        if line is not None and (not block or line == block[-1] + 1):
            block.append(line)
            continue
        if len(block) > 1 and looks_like_code("\n".join(text[x] for x in block)):
            hits.update(block)
        block = [line] if line is not None else []
    return sorted(hits)


class _Normalise(ast.NodeTransformer):
    """Docstrings and `pass` set aside, so a comments-only change compares equal (comments are not in the tree)."""

    def generic_visit(self, node):
        super().generic_visit(node)
        for field in ("body", "orelse", "finalbody"):
            stmts = getattr(node, field, None)
            if not isinstance(stmts, list):
                continue
            if field == "body" and isinstance(node, (ast.Module,) + UNIT_TYPES) and stmts:
                first = stmts[0]
                if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                    stmts = stmts[1:]
            setattr(node, field, [s for s in stmts if not isinstance(s, ast.Pass)])
        return node


def code_of(node):
    try:
        text = ast.unparse(node)
    except Exception:  # noqa: BLE001 - display only
        text = type(node).__name__
    return text.split("\n")[0][:160]


def first_difference(a_list, b_list, where):
    """The first statement whose code differs, descending into a class or function of the same name."""
    for i in range(max(len(a_list), len(b_list))):
        a = a_list[i] if i < len(a_list) else None
        b = b_list[i] if i < len(b_list) else None
        if a is not None and b is not None and ast.dump(a) == ast.dump(b):
            continue
        if isinstance(a, UNIT_TYPES) and isinstance(b, UNIT_TYPES) and type(a) is type(b) and a.name == b.name:
            inner = first_difference(a.body, b.body, f"{where}{a.name}.")
            if inner:
                return inner
        unit = where[:-1] if where else None
        return {
            "unit": unit,
            "beforeLine": getattr(a, "lineno", None),
            "before": code_of(a) if a is not None else None,
            "afterLine": getattr(b, "lineno", None),
            "after": code_of(b) if b is not None else None,
        }
    return None


def compare_code(before_source, after_tree, name):
    before_tree, error = parse(before_source, name)
    if before_tree is None:
        return None, None, f"the module as it was given does not parse ({error}), so its code was not compared"
    a = _Normalise().visit(before_tree)
    b = _Normalise().visit(after_tree)
    if ast.dump(a) == ast.dump(b):
        return True, None, None
    return False, first_difference(a.body, b.body, ""), None


def check(source, name, before=None):
    tree, error = parse(source, name)
    result = {
        "tool": "py_doc_check",
        "language": "python",
        "path": name,
        "compared": before is not None,
        "codeUnchanged": None,
        "firstDifference": None,
        "syntaxError": error,
    }
    if tree is None:
        return {
            **result,
            "passed": False,
            "rules": {},
            "header": {"present": [], "missing": [f[0] for f in HEADER_FIELDS]},
            "units": {"total": 0, "commented": 0, "missing": []},
            "money": {"total": 0, "tagged": 0, "missing": []},
            "aiDisclosure": {"present": False, "namesAssistant": False},
            "cardNumbers": [],
            "commentedOutCode": [],
            "findings": [f"The module does not parse ({error}): no documentation rule can be checked."],
            "notes": [],
        }
    comments, alone = comments_of(source)
    notes = []

    header = docstring(tree) or ""
    present = [fid for fid, _, rx in HEADER_FIELDS if rx.search(header)]
    missing = [(fid, label) for fid, label, _ in HEADER_FIELDS if fid not in present]
    ai_text = field_value(header, "AI-ASSISTED")
    ai = ai_text is not None
    names_assistant = bool(re.search(r"\bNexCODE\b", ai_text or "", re.I))

    units = units_of(tree)
    undocumented = [(node, qual) for node, qual in units if not documented(node, comments, alone)]
    money = [(node, qual) for node, qual in units if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_money_logic(node)]
    untagged = [(node, qual) for node, qual in money if not money_tagged(node, comments)]

    cards = set()
    for line, text in comments.items():
        if card_numbers(text):
            cards.add(line)
    for node in [tree] + [n for n, _ in units]:
        body = getattr(node, "body", None)
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            raw = body[0].value.value
            for start, _ in card_numbers(raw):
                cards.add(body[0].lineno + raw[:start].count("\n"))
    cards = sorted(cards)
    dead = commented_out_code(comments, alone)

    rules = {}
    if before is not None:
        unchanged, difference, why = compare_code(before, tree, name)
        result["codeUnchanged"] = unchanged
        result["firstDifference"] = difference
        if unchanged is None:
            result["compared"] = False
            notes.append(f"Note: {why}.")
        else:
            rules["DOC-008"] = unchanged
    rules["DOC-001"] = not missing
    rules["DOC-002"] = not undocumented
    rules["DOC-004"] = not cards
    rules["DOC-005"] = not dead
    rules["DOC-006"] = not untagged
    rules["DOC-007"] = bool(ai) and names_assistant

    findings = []
    difference = result["firstDifference"]
    if rules.get("DOC-008") is False:
        where = f" in {difference['unit']}" if difference and difference.get("unit") else ""
        if difference:
            findings.append(
                f"DOC-008: a line of code changed{where}. The module as given has "
                f"{json.dumps(difference['before']) if difference['before'] is not None else '(nothing)'}"
                f"{' at line ' + str(difference['beforeLine']) if difference['beforeLine'] else ''}; it now has "
                f"{json.dumps(difference['after']) if difference['after'] is not None else '(nothing)'}"
                f"{' at line ' + str(difference['afterLine']) if difference['afterLine'] else ''}."
            )
        else:
            findings.append("DOC-008: a line of code changed.")
    if not header:
        findings.append("DOC-001: the module has no header docstring (CLR-WIKI-024 C1: the header is the module's docstring).")
    elif missing:
        findings.append(f"DOC-001: the header lacks {', '.join(label for _, label in missing)}.")
    if undocumented:
        findings.append(
            f"DOC-002: {len(undocumented)} of {len(units)} classes and functions have no docstring and no comment "
            f"directly above or below the line that opens them: {', '.join(f'{q} (line {n.lineno})' for n, q in undocumented)}."
        )
    if cards:
        findings.append(f"DOC-004: a card number is in a comment or a docstring on line {', '.join(str(x) for x in cards)}.")
    if dead:
        findings.append(f"DOC-005: commented-out code on line {', '.join(str(x) for x in dead)}.")
    if untagged:
        findings.append(
            f"DOC-006: {len(untagged)} of {len(money)} functions with money logic name no money requirement "
            f"(such as PAY-012) in their docstring or a comment beside the code: {', '.join(f'{q} (line {n.lineno})' for n, q in untagged)}."
        )
    if not rules["DOC-007"]:
        findings.append(
            "DOC-007: the header's AI-ASSISTED field does not name the assistant (NexCODE)."
            if ai
            else "DOC-007: the header does not disclose AI assistance (no AI-ASSISTED field)."
        )

    return {
        **result,
        "passed": all(rules.values()),
        "rules": rules,
        "header": {"present": present, "missing": [fid for fid, _ in missing]},
        "units": {"total": len(units), "commented": len(units) - len(undocumented), "missing": [q for _, q in undocumented]},
        "money": {"total": len(money), "tagged": len(money) - len(untagged), "missing": [q for _, q in untagged]},
        "aiDisclosure": {"present": ai, "namesAssistant": names_assistant, "text": (ai_text or "")[:240]},
        "cardNumbers": cards,
        "commentedOutCode": dead,
        "findings": findings,
        "notes": notes,
    }


def main(argv):
    parser = argparse.ArgumentParser(description="The documentation check of one Python module (STD-DOC).")
    parser.add_argument("--path", required=True)
    parser.add_argument("--before-stdin", action="store_true")
    args = parser.parse_args(argv)
    try:
        with open(args.path, "rb") as fh:
            raw = fh.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError(f"the module is larger than {MAX_BYTES} bytes")
        source = raw.decode("utf-8")
        before = sys.stdin.buffer.read(MAX_BYTES + 1).decode("utf-8") if args.before_stdin else None
        if before is not None and len(before) > MAX_BYTES:
            raise ValueError(f"the module as given is larger than {MAX_BYTES} bytes")
    except (OSError, ValueError, UnicodeDecodeError) as err:
        print(MARK + json.dumps({"tool": "py_doc_check", "language": "python", "path": args.path, "error": f"not checked: {err}", "passed": False}))
        return 2
    result = check(source, args.path, before)
    print(MARK + json.dumps(result))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
