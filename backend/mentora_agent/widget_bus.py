_pending: list[dict] = []


def drain() -> list[dict]:
    widgets = _pending[:]
    _pending.clear()
    return widgets
