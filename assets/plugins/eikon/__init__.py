"""Eikon lifecycle plugin."""

from __future__ import annotations

from .schemas import (
    EIKON_INSTALL_SCHEMA,
    EIKON_LIST_SCHEMA,
    EIKON_REMOVE_SCHEMA,
    EIKON_SEARCH_SCHEMA,
    EIKON_UPDATE_SCHEMA,
    EIKON_USE_SCHEMA,
)
from .tools import (
    _handle_eikon_install,
    _handle_eikon_list,
    _handle_eikon_remove,
    _handle_eikon_search,
    _handle_eikon_update,
    _handle_eikon_use,
    check_herm_available,
)


def register(ctx) -> None:
    for name, schema, handler in [
        ("eikon_install", EIKON_INSTALL_SCHEMA, _handle_eikon_install),
        ("eikon_search", EIKON_SEARCH_SCHEMA, _handle_eikon_search),
        ("eikon_list", EIKON_LIST_SCHEMA, _handle_eikon_list),
        ("eikon_use", EIKON_USE_SCHEMA, _handle_eikon_use),
        ("eikon_update", EIKON_UPDATE_SCHEMA, _handle_eikon_update),
        ("eikon_remove", EIKON_REMOVE_SCHEMA, _handle_eikon_remove),
    ]:
        ctx.register_tool(
            name=name,
            toolset="eikon",
            schema=schema,
            handler=handler,
            check_fn=check_herm_available,
            emoji="⬡",
        )
