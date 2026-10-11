#!/usr/bin/env python3
"""Hermes MCP tools for the Consultation Summaries API.

The server is deliberately small: natural-language interpretation happens in
Hermes, while this process validates inputs and invokes the protected API.
"""

from __future__ import annotations

import json
import base64
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_HANDWRITTEN_IMAGE_BYTES = 3 * 1024 * 1024
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "consultation-summaries"
SERVER_VERSION = "1.0.0"


def api_config() -> tuple[str, dict[str, str]]:
    base_url = os.environ.get("CONSULTATION_SUMMARIES_API_BASE_URL", "").rstrip("/")
    secret = os.environ.get("CONSULTATION_SUMMARIES_API_SECRET", "")
    group_id = os.environ.get("CONSULTATION_SUMMARIES_GROUP_ID", "")
    if not base_url or not secret or not group_id:
        raise ValueError("Consultation API credentials are not configured")
    return base_url, {
        "Authorization": f"Bearer {secret}",
        "X-Hermes-WhatsApp-Group-Id": group_id,
        "Content-Type": "application/json",
    }


def api_request(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    base_url, headers = api_config()
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(payload).get("error", payload)
        except json.JSONDecodeError:
            detail = payload
        raise ValueError(f"API request failed ({error.code}): {detail}") from error


def require_string(arguments: dict[str, Any], name: str, maximum: int) -> str:
    value = arguments.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    value = value.strip()
    if len(value) > maximum:
        raise ValueError(f"{name} is too long")
    return value


def optional_string(arguments: dict[str, Any], name: str, maximum: int) -> str | None:
    value = arguments.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    value = value.strip()
    if not value:
        return None
    if len(value) > maximum:
        raise ValueError(f"{name} is too long")
    return value


def handwritten_image_from_path(arguments: dict[str, Any]) -> dict[str, Any] | None:
    raw_path = optional_string(arguments, "handwritten_summary_image_path", 2_000)
    if not raw_path:
        return None

    path = Path(raw_path).expanduser().resolve()
    configured_roots = os.environ.get(
        "CONSULTATION_SUMMARIES_MEDIA_ROOTS",
        "~/.hermes/cache/images,~/.hermes/image_cache",
    )
    roots = [Path(value.strip()).expanduser().resolve() for value in configured_roots.split(",") if value.strip()]
    if not any(_is_relative_to(path, root) for root in roots):
        raise ValueError("handwritten_summary_image_path must be a WhatsApp image attachment")
    if not path.is_file():
        raise ValueError("The handwritten summary image attachment is no longer available")
    size = path.stat().st_size
    if size < 1 or size > MAX_HANDWRITTEN_IMAGE_BYTES:
        raise ValueError("The handwritten summary image must be 3 MB or smaller")
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise ValueError("The handwritten summary must be a JPEG, PNG, or WebP image")
    return {
        "fileName": path.name,
        "mimeType": mime_type,
        "base64Data": base64.b64encode(path.read_bytes()).decode("ascii"),
    }


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def create_consultation(arguments: dict[str, Any]) -> Any:
    customer = {"fullName": require_string(arguments, "customer_name", 300)}
    for argument_name, api_name, maximum in (
        ("phone", "phone", 50),
        ("email", "email", 320),
        ("external_customer_id", "externalCustomerId", 200),
    ):
        value = optional_string(arguments, argument_name, maximum)
        if value:
            customer[api_name] = value

    if not any(customer.get(key) for key in ("phone", "email", "externalCustomerId")):
        raise ValueError("Provide at least one customer identifier: phone, email, or external_customer_id")

    payload: dict[str, Any] = {"customer": customer, "summary": require_string(arguments, "summary", 100_000)}
    topic = optional_string(arguments, "topic", 500)
    if topic:
        payload["topic"] = topic
    consulted_at = optional_string(arguments, "consulted_at", 100)
    if consulted_at:
        payload["consultedAt"] = consulted_at
    image = handwritten_image_from_path(arguments)
    if image:
        payload["handwrittenSummaryImage"] = image
    return api_request("POST", "/api/consultations", payload)


def search_consultations(arguments: dict[str, Any]) -> Any:
    query = optional_string(arguments, "query", 500)
    if not query:
        raise ValueError("Provide a customer name, phone number, email, or external customer ID")
    params: dict[str, str] = {"limit": str(min(max(int(arguments.get("limit", 20)), 1), 100))}
    if query:
        params["query"] = query
    for key, api_name in (("from_date", "from"), ("to_date", "to")):
        value = optional_string(arguments, key, 100)
        if value:
            params[api_name] = value
    return api_request("GET", "/api/consultations?" + urllib.parse.urlencode(params))


def get_consultation(arguments: dict[str, Any]) -> Any:
    return api_request("GET", f"/api/consultations/{int(arguments['consultation_id'])}")


def get_consultation_history(arguments: dict[str, Any]) -> Any:
    return api_request("GET", f"/api/consultations/{int(arguments['consultation_id'])}/history")


def update_consultation(arguments: dict[str, Any]) -> Any:
    consultation_id = int(arguments["consultation_id"])
    payload: dict[str, Any] = {}
    for argument_name, api_name, maximum in (
        ("summary", "summary", 100_000),
        ("topic", "topic", 500),
        ("consulted_at", "consultedAt", 100),
        ("change_note", "changeNote", 2_000),
    ):
        value = optional_string(arguments, argument_name, maximum)
        if value:
            payload[api_name] = value
    if not any(key in payload for key in ("summary", "topic", "consultedAt")):
        raise ValueError("Provide summary, topic, or consulted_at to update")
    return api_request("PATCH", f"/api/consultations/{consultation_id}", payload)


TOOLS = [
    {
        "name": "create_consultation",
        "description": "Create a customer consultation record. Use only after the user supplied their name, at least one identifier (phone, email, or external customer ID), and the consultation summary. When the incoming WhatsApp message includes a handwritten-summary image, pass its local attachment path as handwritten_summary_image_path so the original image is saved immutably with this initial consultation. Ask a concise clarification if any required information is missing. Never mention internal customer IDs in the WhatsApp response.",
        "inputSchema": {"type": "object", "properties": {
            "customer_name": {"type": "string"}, "phone": {"type": "string"}, "email": {"type": "string"}, "external_customer_id": {"type": "string"},
            "summary": {"type": "string"}, "topic": {"type": "string"}, "consulted_at": {"type": "string", "description": "ISO 8601 timestamp; omit to use now."},
            "handwritten_summary_image_path": {"type": "string", "description": "Absolute local path of the attached WhatsApp handwritten-summary image. Omit when no image was attached."}
        }, "required": ["customer_name", "summary"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False},
    },
    {
        "name": "search_consultations",
        "description": "Search consultation summaries by a customer's name, phone, email, or external customer ID. Use this for requests to find or list consultations. When the user asks for a phone number, show customer.normalizedPhone exactly as returned (the full local Israeli number, for example 0544250186); never mask it with asterisks. Never mention internal customer IDs. When presenting a consultation, show only fields that have a value.",
        "inputSchema": {"type": "object", "properties": {
            "query": {"type": "string"}, "from_date": {"type": "string"}, "to_date": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}
        }, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "get_consultation",
        "description": "Retrieve one consultation by its ID. When reporting the customer phone number, show customer.normalizedPhone exactly as returned; do not mask it. Never mention internal customer IDs, and omit fields with no value from the WhatsApp presentation.",
        "inputSchema": {"type": "object", "properties": {"consultation_id": {"type": "integer", "minimum": 1}}, "required": ["consultation_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "get_consultation_history",
        "description": "Retrieve a consultation and its immutable revision history by consultation ID. Never mention internal customer IDs, and omit fields with no value from the WhatsApp presentation.",
        "inputSchema": {"type": "object", "properties": {"consultation_id": {"type": "integer", "minimum": 1}}, "required": ["consultation_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "update_consultation",
        "description": "Update a consultation. The API preserves an immutable snapshot. Use only when the user clearly identifies the consultation ID and provides the new details; include change_note when the user provides a reason. Never mention internal customer IDs in the WhatsApp response.",
        "inputSchema": {"type": "object", "properties": {
            "consultation_id": {"type": "integer", "minimum": 1}, "summary": {"type": "string"}, "topic": {"type": "string"}, "consulted_at": {"type": "string"}, "change_note": {"type": "string"}
        }, "required": ["consultation_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False},
    },
]

HANDLERS = {"create_consultation": create_consultation, "search_consultations": search_consultations, "get_consultation": get_consultation, "get_consultation_history": get_consultation_history, "update_consultation": update_consultation}


def presentation_data(value: Any, *, inside_customer: bool = False) -> Any:
    """Hide API-only customer IDs and empty values from every tool result."""
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if key == "customerId" or (inside_customer and key == "id"):
                continue
            rendered = presentation_data(item, inside_customer=(key == "customer"))
            if rendered is None or rendered == "" or rendered == [] or rendered == {}:
                continue
            cleaned[key] = rendered
        return cleaned
    if isinstance(value, list):
        return [presentation_data(item, inside_customer=inside_customer) for item in value]
    return value


def result(payload: Any, is_error: bool = False) -> dict[str, Any]:
    visible_payload = presentation_data(payload)
    return {"content": [{"type": "text", "text": json.dumps(visible_payload, ensure_ascii=False)}], "structuredContent": visible_payload, "isError": is_error}


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    request_id, method, params = message.get("id"), message.get("method"), message.get("params") or {}
    if request_id is None:
        return None
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION}, "instructions": "Use these tools for natural-language Hebrew consultation-record requests. Never invent customer information; ask briefly when essential details are missing. Customer IDs are API-internal: never request or mention them. In WhatsApp consultation presentations, omit fields with no value."}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        try:
            name = params.get("name")
            if name not in HANDLERS:
                raise ValueError(f"Unknown tool: {name}")
            return {"jsonrpc": "2.0", "id": request_id, "result": result(HANDLERS[name](params.get("arguments") or {}))}
        except (ValueError, TypeError, KeyError) as error:
            return {"jsonrpc": "2.0", "id": request_id, "result": result({"error": str(error)}, True)}
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}


def main() -> int:
    for line in sys.stdin:
        if line.strip():
            try:
                reply = handle(json.loads(line))
            except json.JSONDecodeError as error:
                reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(error)}}
            if reply is not None:
                print(json.dumps(reply, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
