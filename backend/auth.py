from __future__ import annotations

import csv
import hashlib
import hmac
import secrets
import time
from http import HTTPStatus
from pathlib import Path

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from .common import ApiError

AUTH_COOKIE = "brain_session"
USERS_CSV = Path(__file__).with_name("users.csv")

router = APIRouter(prefix="/api/auth", tags=["Auth"])
sessions: set[str] = set()


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


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(AUTH_COOKIE)
    return bool(token and token in sessions)


@router.get("/me")
def auth_me(request: Request) -> dict[str, object]:
    return {"authenticated": is_authenticated(request)}


@router.post("/login")
def auth_login(payload: LoginRequest, response: Response) -> dict[str, object]:
    stored_hash = _load_password_hash(payload.username)
    time.sleep(2)
    if stored_hash is None or not _verify_password(payload.password, stored_hash):
        raise ApiError(HTTPStatus.UNAUTHORIZED, "Invalid username or password")

    token = secrets.token_urlsafe(32)
    sessions.add(token)
    response.set_cookie(
        AUTH_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    return {"authenticated": True}


@router.post("/logout")
def auth_logout(request: Request, response: Response) -> dict[str, object]:
    token = request.cookies.get(AUTH_COOKIE)
    if token:
        sessions.discard(token)
    response.delete_cookie(AUTH_COOKIE, path="/")
    return {"authenticated": False}
