"""Ticket Club API: Cognito-authenticated, S3-backed serverless endpoints."""

import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


s3 = boto3.client("s3")
BUCKET = os.environ["DATA_BUCKET"]
STATE_KEY = "data/state.json"
EVENT_PREFIX = "data/events/"
MAX_RETRIES = 4


def response(status_code, body):
    """Build the standard JSON response returned to API Gateway and the browser."""
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body),
    }


def error(status_code, message):
    """Return a consistently shaped error message with the requested HTTP status."""
    return response(status_code, {"message": message})


def request_body(event):
    """Read and validate the JSON body sent by the browser in a POST request."""
    try:
        return json.loads(event.get("body") or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Request body must be valid JSON.") from exc


def initial_state():
    """Provide an empty starting data structure for a brand-new ticket bucket."""
    return {"students": [], "prizes": [], "schemaVersion": 1}


def read_state():
    """Load the latest students and prizes snapshot from S3, including its version tag."""
    try:
        item = s3.get_object(Bucket=BUCKET, Key=STATE_KEY)
        return json.loads(item["Body"].read()), item["ETag"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"NoSuchKey", "404"}:
            return initial_state(), None
        raise


def write_state(state, etag):
    """Save a new state snapshot only when the S3 version has not changed underneath us."""
    kwargs = {
        "Bucket": BUCKET,
        "Key": STATE_KEY,
        "Body": json.dumps(state, separators=(",", ":")).encode(),
        "ContentType": "application/json",
        "ServerSideEncryption": "AES256",
    }
    if etag is None:
        kwargs["IfNoneMatch"] = "*"
    else:
        kwargs["IfMatch"] = etag
    s3.put_object(**kwargs)


def is_conflict(exc):
    """Identify S3 errors that mean another request changed the snapshot first."""
    return exc.response["Error"]["Code"] in {"PreconditionFailed", "ConditionalRequestConflict", "412", "409"}


def save_event(event):
    """Store one immutable ticket-history event as its own JSON file in S3."""
    key = f"{EVENT_PREFIX}{event['timestamp'][:10]}/{event['id']}.json"
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(event, separators=(",", ":")).encode(),
        ContentType="application/json",
        ServerSideEncryption="AES256",
        IfNoneMatch="*",
    )


def coach_name(event):
    """Extract the signed-in coach's identifying name from Cognito's JWT claims."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return claims.get("email") or claims.get("cognito:username") or "Coach"


def transaction(event, update):
    """Apply one change safely, retrying when two coaches update the S3 snapshot together."""
    for _ in range(MAX_RETRIES):
        state, etag = read_state()
        result = update(state)
        try:
            write_state(state, etag)
        except ClientError as exc:
            if is_conflict(exc):
                continue
            raise
        if result.get("event"):
            save_event(result["event"])
        return result
    raise RuntimeError("Another update is in progress. Please try again.")


def require_string(payload, field):
    """Return a required non-empty text field, or explain what the caller needs to fix."""
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required.")
    return value.strip()


def require_positive_int(payload, field):
    """Return a required whole-number value greater than zero, rejecting invalid input."""
    value = payload.get(field)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{field} must be a whole number of at least 1.")
    return value


def new_event(student_id, amount, event_type, reason, actor):
    """Create the complete audit-log record for a ticket award or a prize redemption."""
    return {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "studentId": student_id,
        "type": event_type,
        "amount": amount,
        "reason": reason,
        "actor": actor,
    }


def list_events(student_id=None):
    """Read event files from S3, optionally keeping only one student's history."""
    events = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=EVENT_PREFIX):
        for item in page.get("Contents", []):
            event = json.loads(s3.get_object(Bucket=BUCKET, Key=item["Key"])["Body"].read())
            if student_id is None or event["studentId"] == student_id:
                events.append(event)
    return sorted(events, key=lambda item: item["timestamp"], reverse=True)


def handler(event, _context):
    """Route each API Gateway request to the matching Ticket Club operation."""
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    query = event.get("queryStringParameters") or {}
    try:
        if method == "GET" and path == "/health":
            return response(200, {"ok": True})
        if method == "GET" and path == "/students":
            state, _ = read_state()
            return response(200, {"students": state["students"]})
        if method == "POST" and path == "/students":
            payload = request_body(event)
            name = require_string(payload, "name")
            grade = require_string(payload, "grade")

            def create_student(state):
                student = {"id": str(uuid.uuid4()), "name": name, "grade": grade, "balance": 0, "active": True}
                state["students"].append(student)
                return {"student": student}

            return response(201, transaction(event, create_student))
        if method == "GET" and path == "/prizes":
            state, _ = read_state()
            return response(200, {"prizes": state["prizes"]})
        if method == "POST" and path == "/prizes":
            payload = request_body(event)
            name = require_string(payload, "name")
            cost = require_positive_int(payload, "cost")
            stock = payload.get("stock")
            if not isinstance(stock, int) or isinstance(stock, bool) or stock < 0:
                raise ValueError("stock must be a whole number of zero or more.")

            def create_prize(state):
                prize = {"id": str(uuid.uuid4()), "name": name, "cost": cost, "stock": stock, "active": True}
                state["prizes"].append(prize)
                return {"prize": prize}

            return response(201, transaction(event, create_prize))
        if method == "POST" and path == "/ticket-events":
            payload = request_body(event)
            student_id = require_string(payload, "studentId")
            amount = require_positive_int(payload, "amount")
            reason = require_string(payload, "reason")
            actor = coach_name(event)

            def award(state):
                student = next((item for item in state["students"] if item["id"] == student_id and item["active"]), None)
                if student is None:
                    raise ValueError("That active student could not be found.")
                student["balance"] += amount
                ledger_event = new_event(student_id, amount, "earn", reason, actor)
                return {"student": student, "event": ledger_event}

            return response(201, transaction(event, award))
        if method == "POST" and path == "/redemptions":
            payload = request_body(event)
            student_id = require_string(payload, "studentId")
            prize_id = require_string(payload, "prizeId")
            actor = coach_name(event)

            def redeem(state):
                student = next((item for item in state["students"] if item["id"] == student_id and item["active"]), None)
                prize = next((item for item in state["prizes"] if item["id"] == prize_id and item["active"]), None)
                if student is None or prize is None:
                    raise ValueError("The student or prize could not be found.")
                if prize["stock"] < 1:
                    raise ValueError("That prize is out of stock.")
                if student["balance"] < prize["cost"]:
                    raise ValueError(f"{student['name']} needs {prize['cost'] - student['balance']} more tickets.")
                student["balance"] -= prize["cost"]
                prize["stock"] -= 1
                ledger_event = new_event(student_id, -prize["cost"], "redeem", f"Redeemed: {prize['name']}", actor)
                return {"student": student, "prize": prize, "event": ledger_event}

            return response(201, transaction(event, redeem))
        if method == "GET" and path == "/history":
            return response(200, {"events": list_events(query.get("studentId"))})
        return error(404, "Route not found.")
    except ValueError as exc:
        return error(400, str(exc))
    except RuntimeError as exc:
        return error(409, str(exc))
    except ClientError:
        return error(502, "Unable to reach ticket storage.")
    except Exception:
        return error(500, "Unexpected server error.")
