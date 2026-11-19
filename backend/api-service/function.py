"""
AWS Lambda entry point (handler: function.handler).

Wraps the FastAPI app with Mangum so the same app runs on Lambda Function URLs
(LocalStack locally, AWS in the cloud) and under uvicorn for local debugging:

    uvicorn app.main:app --reload --port 8000     # then open http://localhost:8000/docs

A direct invocation with {"action": ...} (no HTTP request context) runs a database
task instead - see app/admin_tasks.py. Only callers with AWS credentials allowed
to invoke the function can do that; Function URL requests always reach the web API.
"""

from mangum import Mangum

from app.main import app

_web = Mangum(app, lifespan="off")


def handler(event, context):
    if isinstance(event, dict) and "action" in event and "requestContext" not in event:
        from app import admin_tasks
        return admin_tasks.run(event)
    return _web(event, context)
