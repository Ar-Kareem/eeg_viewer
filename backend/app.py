from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import auth
from .common import ApiError
from .pages import artifacts, channel_map, channel_quality, eeg, events, h5_explorer, high_amplitude, spectral


def create_app() -> FastAPI:
    app = FastAPI(title="Brain Website API")

    @app.exception_handler(ApiError)
    async def api_error_handler(_request, error: ApiError):
        return JSONResponse(status_code=int(error.status), content={"error": error.message})

    @app.middleware("http")
    async def require_auth(request: Request, call_next):
        path = request.url.path
        public_auth_paths = {"/api/auth/login", "/api/auth/me"}
        if (
            path.startswith("/api")
            and path not in public_auth_paths
            and request.method != "OPTIONS"
            and not auth.is_authenticated(request)
        ):
            return JSONResponse(status_code=HTTPStatus.UNAUTHORIZED, content={"error": "Authentication required"})
        return await call_next(request)

    app.include_router(auth.router)
    app.include_router(eeg.router)
    app.include_router(h5_explorer.router)
    app.include_router(channel_quality.router)
    app.include_router(events.router)
    app.include_router(spectral.router)
    app.include_router(artifacts.router)
    app.include_router(high_amplitude.router)
    app.include_router(channel_map.router)
    return app


app = create_app()
