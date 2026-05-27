"""Tests for portfolio updater message builder."""
import pytest

from agentos.agents.portfolio_updater import build_portfolio_message


def test_build_portfolio_message_basic():
    msg = build_portfolio_message({
        "github_username": "testuser",
        "portfolio_repo": "testuser/portfolio",
    })
    assert "testuser" in msg
    assert "testuser/portfolio" in msg
    assert "github_list_repos" in msg
    assert "github_get_file" in msg
    assert "github_push_file" in msg


def test_build_portfolio_message_with_options():
    msg = build_portfolio_message({
        "github_username": "testuser",
        "portfolio_repo": "testuser/portfolio",
        "content_path": "src/data/projects.json",
        "languages": ["Python", "TypeScript"],
        "max_projects": 5,
        "skip_repos": ["dotfiles", "private-stuff"],
    })
    assert "src/data/projects.json" in msg
    assert "Python" in msg
    assert "TypeScript" in msg
    assert "dotfiles" in msg
    assert "5" in msg


def test_build_portfolio_message_missing_username():
    with pytest.raises(ValueError, match="github_username"):
        build_portfolio_message({"portfolio_repo": "x/y"})


def test_build_portfolio_message_missing_portfolio_repo():
    with pytest.raises(ValueError, match="portfolio_repo"):
        build_portfolio_message({"github_username": "testuser"})


def test_build_portfolio_message_default_content_path():
    msg = build_portfolio_message({
        "github_username": "testuser",
        "portfolio_repo": "testuser/portfolio",
    })
    assert "data/projects.json" in msg
