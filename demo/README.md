# Shop demo

Tiny shopping-cart library for trying Groundwork.

    python3 -m unittest discover -s tests     # run the tests
    python3 -m shop.cli add pen 150 2         # try the CLI

## Try these in Groundwork

**1. Inline edit** - open `shop/formatting.py`, select `format_price`, press Cmd+Alt+K:
> Handle negative cents too (e.g. -250 -> '-$2.50') and update the docstring.

**2. Inline edit** - select `is_truthy`:
> Also treat 'y' and 't' as true, and update the docstring to list every accepted value.

**3. Agent task** (Groundwork side panel, don't name files):
> Add a `remove` command to the CLI that takes an item name and removes it from the cart, add a `Cart.remove` method, cover it with a test, and document the command in the README.

Expect: the Statistician ranks `shop/cli.py`, `shop/cart.py`, `tests/test_cart.py`; you review each hunk; approve the test command `python3 -m unittest discover -s tests`.

**4. Fallback** - break the primary model key in TrueForge and re-run task 1.
