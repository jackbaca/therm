"""Tool schemas for the eikon plugin."""

from __future__ import annotations

EIKON_INSTALL_SCHEMA = {
    "name": "eikon_install",
    "description": (
        "Install a Herm eikon/avatar from the public catalog, a manifest URL, "
        "a git repository, or a local directory. Uses `herm eikon install`; "
        "set_active activates the installed avatar with `herm eikon use`."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "source": {
                "type": "string",
                "description": "Catalog name, HTTPS manifest/base URL, git URL, or local directory.",
            },
            "name": {
                "type": "string",
                "description": "Optional installed name override.",
            },
            "media": {
                "type": "boolean",
                "description": "Whether to fetch source media into the profile. Default true.",
                "default": True,
            },
            "no_source": {
                "type": "boolean",
                "description": "Alias for media=false.",
                "default": False,
            },
            "set_active": {
                "type": "boolean",
                "description": "Activate the installed eikon after install. Default true.",
                "default": True,
            },
            "active_ok": {
                "type": "boolean",
                "description": "Allow replacing the active eikon's backing package when installing over it.",
                "default": False,
            },
        },
        "required": ["source"],
    },
}

EIKON_SEARCH_SCHEMA = {
    "name": "eikon_search",
    "description": "Search the Herm eikon marketplace/catalog via `herm eikon search --json`.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Optional search query."},
        },
    },
}

EIKON_LIST_SCHEMA = {
    "name": "eikon_list",
    "description": "List installed Herm eikons via `herm eikon list --json`.",
    "parameters": {"type": "object", "properties": {}},
}

EIKON_USE_SCHEMA = {
    "name": "eikon_use",
    "description": "Set an installed or bundled Herm eikon as active via `herm eikon use --json`.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Installed or bundled eikon name."},
        },
        "required": ["name"],
    },
}

EIKON_UPDATE_SCHEMA = {
    "name": "eikon_update",
    "description": "Update an installed Herm eikon from its recorded source via `herm eikon update --json`.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Installed eikon name."},
            "active_ok": {
                "type": "boolean",
                "description": "Allow updating the active avatar's backing package.",
                "default": False,
            },
        },
        "required": ["name"],
    },
}

EIKON_REMOVE_SCHEMA = {
    "name": "eikon_remove",
    "description": "Remove an installed Herm eikon via `herm eikon remove --json`.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Installed eikon name."},
            "active_ok": {
                "type": "boolean",
                "description": "Allow clearing the active avatar if this eikon is active.",
                "default": False,
            },
        },
        "required": ["name"],
    },
}
