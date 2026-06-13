"""Short-lived signed tokens for audio file URLs."""

from datetime import datetime, timedelta, timezone

from django.core import signing

PLAYBACK_TTL_SECONDS = 60 * 60  # 1h


def create_playback_token(slug: str) -> tuple[str, str]:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PLAYBACK_TTL_SECONDS)
    payload = {"slug": slug}
    token = signing.dumps(payload, salt="audiobook-playback")
    return token, expires_at.isoformat()


def verify_playback_token(token: str, slug: str) -> bool:
    try:
        payload = signing.loads(token, salt="audiobook-playback", max_age=PLAYBACK_TTL_SECONDS)
    except (signing.BadSignature, signing.SignatureExpired):
        return False
    return payload.get("slug") == slug
