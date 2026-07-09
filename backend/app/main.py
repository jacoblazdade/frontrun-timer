import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.routers import auth, events_admin, finishes, participants, public, races

app = FastAPI(title="Frontrun Timer")

app.include_router(auth.router)
app.include_router(public.router)
app.include_router(races.router)
app.include_router(finishes.router)
app.include_router(participants.router)
app.include_router(events_admin.router)


@app.get("/api/health")
def health():
    return {"ok": True}


class SPAStaticFiles(StaticFiles):
    """Serves the built frontend; unknown paths fall back to index.html so
    client-side routes like /admin/finish work on hard reload."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


_static_dir = get_settings().static_dir
if _static_dir and os.path.isdir(_static_dir):
    app.mount("/", SPAStaticFiles(directory=_static_dir, html=True), name="spa")
