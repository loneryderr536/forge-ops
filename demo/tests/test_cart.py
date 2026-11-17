import unittest

from shop.cart import Cart
from shop.formatting import format_price, is_truthy


class CartTests(unittest.TestCase):
    def test_total_and_merge(self):
        cart = Cart()
        cart.add("pen", 150, 2)
        cart.add("pen", 150)
        self.assertEqual(cart.total(), 450)

    def test_discount(self):
        cart = Cart()
        cart.add("book", 2000)
        self.assertEqual(cart.apply_discount(10), 1800)

    def test_bad_quantity(self):
        with self.assertRaises(ValueError):
            Cart().add("x", 100, 0)


class FormattingTests(unittest.TestCase):
    def test_format_price(self):
        self.assertEqual(format_price(1999), "$19.99")
        self.assertEqual(format_price(5), "$0.05")

    def test_is_truthy(self):
        self.assertTrue(is_truthy("Yes"))
        self.assertFalse(is_truthy("off"))


if __name__ == "__main__":
    unittest.main()
