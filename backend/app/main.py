import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import db, seo
from app.api import account, friends
from app.api.routes import invalid_situation_handler, router
from app.recommend.engine import Comps, InvalidSituation, Matchups, load_bans, load_queues, load_weights
from app.scheduler import Scheduler
from app.security import SecurityMiddleware, content_security_policy, inline_script_hashes


@asynccontextmanager
async def lifespan(app: FastAPI):
    path = os.environ.get("PICKGAK_DB", db.DEFAULT_PATH)
    db.migrate_legacy_file(path)
    app.state.db = db.ThreadConnections(path)
    app.state.matchups = Matchups.load()
    app.state.weights = load_weights()
    app.state.queues = load_queues()
    app.state.bans = load_bans()
    app.state.comps = Comps.load()
    scheduler = None
    if os.environ.get("PICKGAK_AUTOCOLLECT", "1") != "0":
        # 수집은 별도 연결로 (요청 처리와 쓰기 트랜잭션이 섞이지 않게)
        scheduler = Scheduler(db.connect(path, migrate=False))
        scheduler.start()
    yield
    if scheduler:
        scheduler.stop()
    app.state.db.close_all()


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # 수집 요청마다 찍히는 로그는 생략

# 배포(정적 화면을 함께 내보낼 때)에서는 API 문서(/docs, /openapi.json)를 공개하지 않는다
_static = os.environ.get("PICKGAK_STATIC")
_docs = os.environ.get("PICKGAK_DOCS", "0" if _static else "1") == "1"
app = FastAPI(
    title="PickGak",
    lifespan=lifespan,
    docs_url="/docs" if _docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs else None,
)
if not _static:  # 개발용 (배포는 같은 출처에서만 쓰므로 CORS를 열지 않는다)
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"]
    )
app.add_exception_handler(InvalidSituation, invalid_situation_handler)
app.include_router(router)
app.include_router(account.router)
app.include_router(friends.router)

# The Flatpak repository lives on GitHub Pages (published by .github/workflows/release.yml). It used to be
# served here, so remotes added from this address follow the redirect.
FLATPAK_URL = os.environ.get("PICKGAK_FLATPAK_URL", "https://seolcu.github.io/pickgak/flatpak/")


@app.get("/api/flatpak/{path:path}", include_in_schema=False)
def flatpak_moved(path: str):
    return RedirectResponse(FLATPAK_URL + path, status_code=302)


class SpaFiles(StaticFiles):
    """빌드된 프론트엔드. 화면 주소는 주소별 메타데이터를 넣은 index.html로 (seo.py). /api는 제외"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pages = seo.PageRenderer(Path(self.directory) / "index.html")

    def page(self, path, scope):
        page_path = "/" if path in ("", ".", "index.html") else "/" + path
        return self.pages.render(scope, page_path, scope["app"].state.db.get())

    async def get_response(self, path, scope):
        if path in ("", ".", "index.html"):
            return self.page(path, scope)
        try:
            resp = await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code != 404 or path.startswith("api"):
                raise
            return self.page(path, scope)
        # 해시가 붙은 파일은 오래, index.html은 매번 확인
        resp.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        )
        return resp


# 배포(단일 컨테이너)에서는 백엔드가 프론트엔드도 함께 내보낸다. 개발에서는 Vite가 따로 띄운다
if _static:

    @app.get("/robots.txt", include_in_schema=False)
    def robots():
        return PlainTextResponse(seo.robots_txt(), headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/sitemap.xml", include_in_schema=False)
    def sitemap(request: Request):
        return Response(
            seo.sitemap_xml(request.app.state.db.get()),
            media_type="application/xml",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    app.mount("/", SpaFiles(directory=_static, html=True), name="static")

app.add_middleware(
    SecurityMiddleware,
    csp=content_security_policy(inline_script_hashes(Path(_static) / "index.html")) if _static else None,
    hsts=os.environ.get("PICKGAK_SECURE_COOKIE") == "1",
)
