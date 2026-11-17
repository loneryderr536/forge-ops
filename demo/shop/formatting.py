def format_price(cents):
    """Format an integer number of cents as a dollar string, e.g. 1999 -> '$19.99'."""
    dollars, remainder = divmod(cents, 100)
    return f"${dollars}.{remainder:02d}"


def is_truthy(value):
    """Return True when value is one of: 'true', '1', 'yes', 'on' (case-insensitive)."""
    return str(value).strip().lower() in {"true", "1", "yes", "on"}
