"""Importing this package registers every tool."""

from apos_processing.tools import (  # noqa: F401
    ai,
    analyze,
    basic,
    convert,
    convert_more,
    edit,
    forms,
    redact_auto,
    secure,
    sign,
    transform,
)
from apos_processing.tools.registry import all_tools, get_tool

__all__ = ["all_tools", "get_tool"]
