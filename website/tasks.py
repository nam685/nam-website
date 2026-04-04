from config.celery import app


@app.task
def run_mission(mission_id):
    """Stub -- full implementation in Task 5."""
    pass
