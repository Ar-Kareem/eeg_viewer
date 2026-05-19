from backend.app import app
from backend.config import PORT


def main() -> None:
    import uvicorn

    uvicorn.run("backend.app:app", host="127.0.0.1", port=PORT, reload=True)


if __name__ == "__main__":
    main()
