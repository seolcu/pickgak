"""보안 헤더와 교차 출처 요청 차단.

- 모든 응답: nosniff, 프레임 금지, 리퍼러 최소화, 권한 정책, (HTTPS 배포면) HSTS
- 화면(HTML): CSP. index.html의 인라인 스크립트(테마 깜빡임 방지)는 해시로만 허용한다
- 상태를 바꾸는 /api 요청(POST·PUT·PATCH·DELETE): 다른 사이트에서 온 요청이면 거부 (CSRF 방어,
  SameSite=Lax 쿠키에 더한 이중 방어)
"""

import base64
import hashlib
import re
from pathlib import Path

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
# 영웅 초상화는 넥슨 CDN에서 바로 받는다
IMG_HOSTS = "https://sht-vod.dn.nexoncdn.co.kr"


def inline_script_hashes(index_html: Path) -> list[str]:
    html = index_html.read_text(encoding="utf-8")
    scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    return [f"'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'" for s in scripts]


def content_security_policy(script_hashes: list[str]) -> str:
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self' " + " ".join(script_hashes),
            # 알림(sonner)이 실행 중에 <style>을 넣고, React는 style 속성을 쓴다.
            # 스크립트는 해시로만 허용하므로 스타일 인라인 허용의 위험은 CSS 주입 수준에 그친다
            "style-src 'self' 'unsafe-inline'",
            f"img-src 'self' data: {IMG_HOSTS}",
            "font-src 'self' data:",
            "connect-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )


class SecurityMiddleware:
    def __init__(self, app: ASGIApp, *, csp: str | None, hsts: bool):
        self.app, self.csp, self.hsts = app, csp, hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        if scope["method"] in UNSAFE and scope["path"].startswith("/api/") and not same_origin(headers):
            resp = JSONResponse({"detail": {"code": "cross_origin", "params": {}}}, status_code=403)
            return await resp(scope, receive, self._wrap(send, scope))
        await self.app(scope, receive, self._wrap(send, scope))

    def _wrap(self, send: Send, scope: Scope):
        api = scope["path"].startswith("/api/")
        auth = scope["path"].startswith(("/api/auth/", "/api/players", "/api/friends"))

        async def wrapped(message: Message):
            if message["type"] == "http.response.start":
                h = list(message.get("headers", []))
                names = {k.lower() for k, _ in h}

                def add(k: str, v: str):
                    if k.encode() not in names:
                        h.append((k.encode(), v.encode()))

                add("x-content-type-options", "nosniff")
                add("x-frame-options", "DENY")
                add("referrer-policy", "strict-origin-when-cross-origin")
                add("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
                add("cross-origin-opener-policy", "same-origin")
                if self.hsts:
                    add("strict-transport-security", "max-age=31536000")
                if auth:
                    # 계정·프로필 응답은 어디에도 캐시하지 않는다
                    h = [(k, v) for k, v in h if k.lower() != b"cache-control"]
                    h.append((b"cache-control", b"no-store"))
                ctype = next((v for k, v in h if k.lower() == b"content-type"), b"")
                if self.csp and not api and ctype.startswith(b"text/html"):
                    add("content-security-policy", self.csp)
                message["headers"] = h
            await send(message)

        return wrapped


def same_origin(headers: dict[str, str]) -> bool:
    """Origin(없으면 Sec-Fetch-Site)이 이 사이트와 같은지. 둘 다 없으면 브라우저가 아닌 클라이언트로 보고 허용"""
    origin = headers.get("origin")
    if origin:
        host = headers.get("host", "")  # 앞단 리버스 프록시는 Host를 그대로 넘긴다
        return origin.split("://", 1)[-1].rstrip("/") == host
    site = headers.get("sec-fetch-site")
    return site in (None, "same-origin", "none")
