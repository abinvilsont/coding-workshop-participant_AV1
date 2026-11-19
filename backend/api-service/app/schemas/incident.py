from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.models import HistoryEvent, IncidentCategory, IncidentPriority, IncidentStatus


def _strip_required(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("This field is required.")
    return v


def _text(max_length: int):
    """Required, trimmed, non-empty text with a maximum length."""
    return Annotated[str, AfterValidator(_strip_required), Field(max_length=max_length)]


Title = _text(200)
LongText = _text(5000)


# ---------------------------------------------------------------- requests

class IncidentCreate(BaseModel):
    title: Title
    description: LongText
    category: IncidentCategory
    priority: IncidentPriority = IncidentPriority.MEDIUM
    building_id: int
    floor_id: int | None = None
    seat_id: int | None = None
    location_details: str | None = Field(default=None, max_length=255)


class IncidentUpdate(BaseModel):
    """Partial update. Which fields a caller may change depends on their role."""

    title: Title | None = None
    description: LongText | None = None
    category: IncidentCategory | None = None
    building_id: int | None = None
    floor_id: int | None = None
    seat_id: int | None = None
    location_details: str | None = Field(default=None, max_length=255)
    # admin only
    priority: IncidentPriority | None = None
    is_escalated: bool | None = None


class StatusChange(BaseModel):
    status: IncidentStatus
    comment: str | None = Field(default=None, max_length=2000)


class AssignIn(BaseModel):
    engineer_id: int


class MergeIn(BaseModel):
    target_id: int  # the incident this duplicate is merged into


class EscalateIn(BaseModel):
    reason: _text(2000)
    requested_priority: IncidentPriority | None = None


def _strip_optional(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


class ReviewIn(BaseModel):
    """Create or replace your review of the engineer (PUT/PATCH send the whole review)."""

    rating: int = Field(ge=1, le=5, description="1 (poor) to 5 (excellent)")
    comment: Annotated[str | None, Field(max_length=2000), AfterValidator(_strip_optional)] = None


class NoteCreate(BaseModel):
    body: LongText
    is_internal: bool = False


# ---------------------------------------------------------------- responses

class IncidentSummary(BaseModel):
    id: int
    reference: str
    title: str
    category: IncidentCategory
    priority: IncidentPriority
    status: IncidentStatus
    requested_priority: IncidentPriority | None
    is_escalated: bool
    created_at: datetime
    updated_at: datetime
    building: str
    floor: str | None
    seat: str | None
    location_details: str | None
    reported_by: str
    assigned_engineer: str | None
    merged_into_id: int | None = None


class IncidentList(BaseModel):
    items: list[IncidentSummary]
    total: int


class NoteOut(BaseModel):
    id: int
    body: str
    is_internal: bool
    created_at: datetime
    author_id: int
    author_name: str
    author_role: str


class HistoryOut(BaseModel):
    id: int
    event_type: HistoryEvent
    from_value: str | None
    to_value: str | None
    comment: str | None
    changed_by: str | None
    created_at: datetime


class Permissions(BaseModel):
    can_edit: bool
    can_set_priority: bool
    can_assign: bool
    can_escalate: bool
    can_add_note: bool
    can_add_internal_note: bool
    can_delete: bool
    can_merge: bool = False
    can_review: bool = False
    status_transitions: list[IncidentStatus]


class LinkedIncident(BaseModel):
    id: int
    reference: str
    title: str
    reported_by: str | None = None


class ReviewOut(BaseModel):
    id: int
    engineer_id: int
    engineer_name: str
    reviewer_id: int
    reviewer_name: str
    rating: int
    comment: str | None
    created_at: datetime
    updated_at: datetime


class EngineerReviewOut(ReviewOut):
    """A review as listed on the admin's Engineers page."""

    incident_id: int
    incident_reference: str
    incident_title: str


class Follower(BaseModel):
    id: int
    name: str
    escalation_requested_at: datetime | None = None  # when they asked to escalate it


class SimilarIncident(BaseModel):
    """An open incident that may be the problem someone is about to report.
    Deliberately brief: no reporter name, description or notes."""

    id: int
    reference: str
    title: str
    category: IncidentCategory
    status: IncidentStatus
    building: str
    floor: str | None
    seat: str | None
    is_escalated: bool
    created_at: datetime
    relation: str | None  # 'reporter' / 'follower' when it's already the caller's


class EscalationRequestIn(BaseModel):
    reason: Annotated[str | None, Field(max_length=2000), AfterValidator(_strip_optional)] = None


class IncidentDetail(IncidentSummary):
    description: str
    building_id: int
    floor_id: int | None
    seat_id: int | None
    reported_by_id: int
    assigned_engineer_id: int | None
    assigned_at: datetime | None
    escalation_reason: str | None
    escalated_at: datetime | None
    resolved_at: datetime | None
    closed_at: datetime | None
    notes: list[NoteOut]
    history: list[HistoryOut]
    permissions: Permissions
    merged_into: LinkedIncident | None = None      # set on a duplicate
    merged_from: list[LinkedIncident] = []         # duplicates merged into this one
    followers: list[Follower] = []                 # their reporters, kept informed
    reviews: list[ReviewOut] = []                  # admins: all; employees: their own; engineers: none
