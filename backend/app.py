from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .common import ApiError
from .pages import artifacts, channel_map, channel_quality, eeg, events, h5_explorer, high_amplitude, spectral


def create_app() -> FastAPI:
    app = FastAPI(title="Brain Website API")

    @app.exception_handler(ApiError)
    async def api_error_handler(_request, error: ApiError):
        return JSONResponse(status_code=int(error.status), content={"error": error.message})

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
