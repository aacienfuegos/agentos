from .filesystem import read_file, write_file, list_directory, run_command
from .github import (
    github_list_prs, github_get_pr_diff, github_post_comment,
    github_list_issues, github_get_file, github_push_file,
)
from .web import fetch_url
from .notifications import send_notification

TOOL_REGISTRY: dict = {
    "read_file": read_file,
    "write_file": write_file,
    "list_directory": list_directory,
    "run_command": run_command,
    "github_list_prs": github_list_prs,
    "github_get_pr_diff": github_get_pr_diff,
    "github_post_comment": github_post_comment,
    "github_list_issues": github_list_issues,
    "github_get_file": github_get_file,
    "github_push_file": github_push_file,
    "fetch_url": fetch_url,
    "send_notification": send_notification,
}

TOOL_SCHEMAS: dict[str, dict] = {
    "read_file": {
        "name": "read_file",
        "description": "Read the contents of a file",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the file to read"}
            },
            "required": ["path"],
        },
    },
    "write_file": {
        "name": "write_file",
        "description": "Write content to a file",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    "list_directory": {
        "name": "list_directory",
        "description": "List files in a directory",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path"}
            },
            "required": ["path"],
        },
    },
    "run_command": {
        "name": "run_command",
        "description": "Run a shell command (sandboxed)",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Command to execute"},
                "cwd": {"type": "string", "description": "Working directory (optional)"},
            },
            "required": ["command"],
        },
    },
    "github_list_prs": {
        "name": "github_list_prs",
        "description": "List open pull requests in a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string", "description": "Repository in format 'owner/repo'"},
                "state": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"},
            },
            "required": ["repo"],
        },
    },
    "github_get_pr_diff": {
        "name": "github_get_pr_diff",
        "description": "Get the diff of a pull request",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "pr_number": {"type": "integer"},
            },
            "required": ["repo", "pr_number"],
        },
    },
    "github_post_comment": {
        "name": "github_post_comment",
        "description": "Post a comment on a GitHub issue or pull request",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "issue_number": {"type": "integer"},
                "body": {"type": "string", "description": "Comment body in markdown"},
            },
            "required": ["repo", "issue_number", "body"],
        },
    },
    "github_list_issues": {
        "name": "github_list_issues",
        "description": "List issues in a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "state": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"},
                "labels": {"type": "string", "description": "Comma-separated label names"},
            },
            "required": ["repo"],
        },
    },
    "github_get_file": {
        "name": "github_get_file",
        "description": "Get the content of a file from a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "ref": {"type": "string", "description": "Branch, tag, or commit SHA (default: main)"},
            },
            "required": ["repo", "path"],
        },
    },
    "github_push_file": {
        "name": "github_push_file",
        "description": "Create or update a file in a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "content": {"type": "string", "description": "File content"},
                "message": {"type": "string", "description": "Commit message"},
                "branch": {"type": "string", "default": "main"},
            },
            "required": ["repo", "path", "content", "message"],
        },
    },
    "fetch_url": {
        "name": "fetch_url",
        "description": "Fetch content from a URL",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "method": {"type": "string", "enum": ["GET", "POST"], "default": "GET"},
            },
            "required": ["url"],
        },
    },
}


def get_tool_schemas(tool_names: list[str]) -> list[dict]:
    return [TOOL_SCHEMAS[name] for name in tool_names if name in TOOL_SCHEMAS]
