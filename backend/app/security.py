"""Password hashing (argon2 via passlib) and HMAC-signed session tokens.

Sessions are stateless: the cookie holds base64(payload).hmac_sha256(payload),
where payload = {"uid": user_id, "exp": unix_ts}. Roles are looked up from the
DB on every request, so a role change takes effect immediately.
"""

import base64
import hashlib
import hmac
import json
import time

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"])


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def create_session_token(user_id: int, secret: str, max_age: int) -> str:
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"uid": user_id, "exp": int(time.time()) + max_age}).encode()
        )
        .decode()
        .rstrip("=")
    )
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def read_session_token(token: str, secret: str) -> int | None:
    """Returns the user id, or None for anything invalid or expired."""
    try:
        payload, sig = token.rsplit(".", 1)
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["exp"] < time.time():
            return None
        return int(data["uid"])
    except Exception:
        return None
