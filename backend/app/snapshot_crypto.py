"""Encryption for published snapshots (login-protected static hosting).

The browser can only read the data after deriving the same key from the username and
password the user types (WebCrypto, see frontend/src/lib/auth/crypto.ts):

    key  = PBKDF2-HMAC-SHA256(password = "<username>:<password>", salt, iterations) -> 256 bits
    file = iv (12 bytes) || AES-256-GCM(key, iv, gzip(JSON bundle))   # GCM tag appended

GCM authentication makes a wrong username/password fail cleanly instead of producing
garbage. The salt and iteration count are not secret and are published in meta.json.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITERATIONS = 600_000  # OWASP 2023+ guidance for PBKDF2-HMAC-SHA256


def derive_key(username: str, password: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", f"{username}:{password}".encode(), salt, iterations, dklen=32)


def encrypt_bundle(bundle: dict, username: str, password: str) -> tuple[bytes, dict]:
    """Returns (ciphertext file bytes, public KDF parameters for meta.json)."""
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = derive_key(username, password, salt)
    plaintext = gzip.compress(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False).encode(), mtime=0)
    blob = iv + AESGCM(key).encrypt(iv, plaintext, None)
    kdf = {"name": "PBKDF2", "hash": "SHA-256", "iterations": ITERATIONS, "salt": base64.b64encode(salt).decode()}
    return blob, kdf


def decrypt_bundle(blob: bytes, username: str, password: str, kdf: dict) -> dict:
    """Mirror of the browser's decryption, used by tests."""
    key = derive_key(username, password, base64.b64decode(kdf["salt"]), kdf["iterations"])
    plaintext = AESGCM(key).decrypt(blob[:12], blob[12:], None)
    return json.loads(gzip.decompress(plaintext))
