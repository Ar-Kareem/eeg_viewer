from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .errors import ApiError
from .pages import channel_quality, eeg, h5_explorer


def create_app() -> FastAPI:
    app = FastAPI(title="Brain Website API")

    @app.exception_handler(ApiError)
    async def api_error_handler(_request, error: ApiError):
        return JSONResponse(status_code=int(error.status), content={"error": error.message})

    app.include_router(eeg.router)
    app.include_router(h5_explorer.router)
    app.include_router(channel_quality.router)
    return app


app = create_app()
