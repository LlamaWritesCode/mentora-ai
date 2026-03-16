import json
import logging
from . import widget_bus

log = logging.getLogger(__name__)

VALID_WIDGET_TYPES = {"ProbabilityTable", "EquationSolver", "Flashcard"}

_SCHEMAS = {
    "ProbabilityTable": lambda d: isinstance(d.get("rows"), list) and all(
        isinstance(r.get("label"), str) and isinstance(r.get("value"), (int, float))
        for r in d["rows"]
    ),
    "EquationSolver": lambda d: isinstance(d.get("steps"), list) and all(
        isinstance(s.get("expression"), str) and isinstance(s.get("explanation"), str)
        for s in d["steps"]
    ),
    "Flashcard": lambda d: isinstance(d.get("term"), str) and isinstance(d.get("definition"), str),
}


def render_generative_widget(widget_type: str, data_json: str) -> str:
    """Render an interactive UI widget in the user's side panel.

    Use this instead of plain text when the response is:
    - A probability/Bayesian distribution  → widget_type="ProbabilityTable"
    - A step-by-step equation or derivation → widget_type="EquationSolver"
    - A vocabulary term or concept drill    → widget_type="Flashcard"

    Args:
        widget_type: One of "ProbabilityTable", "EquationSolver", "Flashcard".
        data_json: JSON string matching the widget's schema (see below).

          ProbabilityTable: {"title": str, "rows": [{"label": str, "value": float}]}
          EquationSolver:   {"title": str, "steps": [{"expression": str, "explanation": str}]}
          Flashcard:        {"term": str, "definition": str, "example": str}
    """
    if widget_type not in VALID_WIDGET_TYPES:
        return f"Unknown widget type '{widget_type}'. Choose from: {', '.join(VALID_WIDGET_TYPES)}"

    try:
        data = json.loads(data_json)
    except json.JSONDecodeError as e:
        return f"Invalid data_json: {e}"

    if not isinstance(data, dict):
        return f"data_json must be a JSON object, got {type(data).__name__}"

    validator = _SCHEMAS.get(widget_type)
    if validator and not validator(data):
        return f"data_json does not match schema for '{widget_type}'"

    log.info("[widget] render_generative_widget: type=%s", widget_type)
    widget_bus._pending.append({"widget_type": widget_type, "data": data})
    return f"Widget '{widget_type}' sent to the side panel."
