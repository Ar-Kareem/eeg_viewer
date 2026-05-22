from __future__ import annotations

import getpass
import hashlib
import secrets


def main() -> None:
    password = getpass.getpass("Password: ").encode("utf-8")
    salt = secrets.token_hex(16)
    iterations = 260000
    digest = hashlib.pbkdf2_hmac("sha256", password, bytes.fromhex(salt), iterations).hex()
    print(f"pbkdf2_sha256${iterations}${salt}${digest}")


if __name__ == "__main__":
    main()
