import logging

_pending: list[dict] = []


def add_to_notes(topic: str, summary: str) -> str:
    """Save the current topic and the assistant's explanation to the user's Notes tab.
    Call this whenever the user says 'add to notes', 'save this', 'remember this', or similar.

    Args:
        topic: Short title for the note (e.g. 'Bayes Theorem').
        summary: The explanation or key takeaway to save.
    """
    logging.getLogger(__name__).info("[notes] add_to_notes called: topic=%r", topic)
    _pending.append({"topic": topic, "summary": summary})
    return "Saved to notes."


def drain() -> list[dict]:
    notes = _pending[:]
    _pending.clear()
    return notes
