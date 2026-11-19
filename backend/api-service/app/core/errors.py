"""Errors that belong to one input field.

Raise FieldError instead of HTTPException when a rule check fails because of a
specific field (a duplicate email, a floor from another building, a full
engineer). The response then also carries `errors: [{loc: ["body", field], msg}]`
- the same shape as validation errors - so the form shows the message next to
that field instead of at the top of the page.
"""

from fastapi import HTTPException


class FieldError(HTTPException):
    def __init__(self, status_code: int, field: str, message: str):
        super().__init__(status_code, message)
        self.field = field
