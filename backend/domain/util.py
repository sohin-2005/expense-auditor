import re


def ensure_string_list(value):
    if isinstance(value, list):
        out = []
        for x in value:
            s = str(x).strip()
            if s:
                out.append(s)
        return out

    if isinstance(value, str):
        parts = re.split(r"[\n,•]+", value)
        return [p.strip(" -\t") for p in parts if p.strip(" -\t")]

    return []


def ensure_object(value):
    return value if isinstance(value, dict) else {}


def sanitize_paging(limit: int = 0, offset: int = 0, max_limit: int = 500):
    try:
        limit = int(limit or 0)
    except Exception:
        limit = 0
    try:
        offset = int(offset or 0)
    except Exception:
        offset = 0

    if limit < 0:
        limit = 0
    if offset < 0:
        offset = 0
    if limit > max_limit:
        limit = max_limit
    return limit, offset


POSTGREST_PAGE_SIZE = 1000
FETCH_ALL_MAX_ROWS = 50000
