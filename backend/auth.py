from __future__ import annotations

import csv
import hashlib
import hmac
import base64
import secrets
import time
from http import HTTPStatus
from pathlib import Path

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from .common import ApiError

AUTH_COOKIE = "brain_session"
USERS_CSV = Path(__file__).with_name("users.csv")
SESSION_SECRET_FILE = Path(__file__).with_name("session_secret.txt")
SESSION_SECONDS = 12 * 60 * 60

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


def _load_password_hash(username: str) -> str | None:
    if not USERS_CSV.is_file():
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "User CSV is missing")

    requested_username = username.strip()
    with USERS_CSV.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            csv_username = (row.get("username") or "").strip()
            password_hash = row.get("password_hash") or ""
            if csv_username == requested_username:
                return password_hash

    return None


def _session_secret() -> bytes:
    if not SESSION_SECRET_FILE.is_file():
        SESSION_SECRET_FILE.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return SESSION_SECRET_FILE.read_text(encoding="utf-8").strip().encode("utf-8")


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iteration_text, salt_hex, digest_hex = stored_hash.split("$", 3)
        iterations = int(iteration_text)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "Admin password hash is invalid")

    if algorithm != "pbkdf2_sha256":
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "Unsupported password hash algorithm")

    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations).hex()
    return hmac.compare_digest(digest, digest_hex)


def _sign_session_payload(payload: str) -> str:
    return hmac.new(_session_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _create_session_token(username: str) -> str:
    expires_at = int(time.time()) + SESSION_SECONDS
    payload = f"{username}:{expires_at}:{secrets.token_urlsafe(16)}"
    signature = _sign_session_payload(payload)
    token = f"{payload}:{signature}".encode("utf-8")
    return base64.urlsafe_b64encode(token).decode("ascii")


def _verify_session_token(token: str | None) -> bool:
    if not token:
        return False
    try:
        decoded = base64.b64decode(token.encode("ascii"), altchars=b"-_", validate=True).decode("utf-8")
        username, expires_text, _nonce, signature = decoded.rsplit(":", 3)
        expires_at = int(expires_text)
    except (ValueError, UnicodeDecodeError):
        return False

    if expires_at < int(time.time()) or _load_password_hash(username) is None:
        return False

    payload = f"{username}:{expires_text}:{_nonce}"
    return hmac.compare_digest(_sign_session_payload(payload), signature)


def is_authenticated(request: Request) -> bool:
    return _verify_session_token(request.cookies.get(AUTH_COOKIE))


@router.get("/me")
def auth_me(request: Request) -> dict[str, object]:
    return {"authenticated": is_authenticated(request)}


@router.post("/login")
def auth_login(payload: LoginRequest, response: Response) -> dict[str, object]:
    stored_hash = _load_password_hash(payload.username)
    time.sleep(2)
    if stored_hash is None or not _verify_password(payload.password, stored_hash):
        raise ApiError(HTTPStatus.UNAUTHORIZED, "Invalid username or password")

    token = _create_session_token(payload.username.strip())
    response.set_cookie(
        AUTH_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=SESSION_SECONDS,
    )
    return {"authenticated": True}


@router.post("/logout")
def auth_logout(request: Request, response: Response) -> dict[str, object]:
    response.delete_cookie(AUTH_COOKIE, path="/")
    return {"authenticated": False}
