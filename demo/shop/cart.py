from .formatting import format_price


class Cart:
    """Holds items as (name, unit price in cents, quantity)."""

    def __init__(self):
        self.items = {}

    def add(self, name, price_cents, quantity=1):
        if quantity < 1:
            raise ValueError("quantity must be at least 1")
        if name in self.items:
            price, existing = self.items[name]
            self.items[name] = (price, existing + quantity)
        else:
            self.items[name] = (price_cents, quantity)

    def total(self):
        return sum(price * qty for price, qty in self.items.values())

    def apply_discount(self, percent):
        """Return the total in cents after a percentage discount."""
        return self.total() - self.total() * percent // 100

    def summary(self):
        lines = [f"{qty} x {name} @ {format_price(price)}" for name, (price, qty) in self.items.items()]
        lines.append(f"Total: {format_price(self.total())}")
        return "\n".join(lines)
