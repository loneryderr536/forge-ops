import sys

from .cart import Cart


def main(argv=None):
    """Commands: add <name> <price_cents> [qty], total, summary."""
    argv = list(sys.argv[1:] if argv is None else argv)
    cart = Cart()
    if not argv:
        print("usage: python -m shop.cli <command> ...")
        return 1
    command, args = argv[0], argv[1:]
    if command == "add":
        cart.add(args[0], int(args[1]), int(args[2]) if len(args) > 2 else 1)
        print(cart.summary())
    elif command == "total":
        print(cart.total())
    elif command == "summary":
        print(cart.summary())
    else:
        print(f"unknown command: {command}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
