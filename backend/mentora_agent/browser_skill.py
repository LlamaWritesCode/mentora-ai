"""
browser_skill.py

Provides the BrowserSkill tool for the ADK root agent.
Uses Playwright in a background browser instance — completely separate
from the user's Chrome window so it never disrupts their session.

Available actions the agent can call:
  - navigate(url)          Open a URL and return page text + screenshot
  - click_at(x, y)         Click a coordinate on the current page
  - scroll_to_text(query)  Scroll until matching text is visible
  - summarize_page()       Return clean text content of the current page
"""

import base64
from typing import Optional

from playwright.async_api import async_playwright, Browser, Page

# ── Browser singleton ─────────────────────────────────────────────────────────

_browser: Optional[Browser] = None
_page:    Optional[Page]    = None

async def _get_page() -> Page:
    global _browser, _page
    if _browser is None or not _browser.is_connected():
        pw = await async_playwright().start()
        _browser = await pw.chromium.launch(headless=True)
    if _page is None or _page.is_closed():
        _page = await _browser.new_page()
        await _page.set_viewport_size({"width": 1280, "height": 720})
    return _page

# ── Tool actions ──────────────────────────────────────────────────────────────

async def navigate(url: str) -> dict:
    """
    Open a URL in the background browser.
    Returns the page title, a summary of the text content, and a base64 screenshot.

    Args:
        url: The full URL to navigate to (must include https://).
    """
    page = await _get_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=15_000)
    await page.wait_for_timeout(1500)  # let dynamic content settle

    title   = await page.title()
    text    = await _extract_text(page)
    screenshot_b64 = await _screenshot_b64(page)

    return {
        "title":      title,
        "url":        page.url,
        "text":       text[:4000],   # truncate for context window
        "screenshot": screenshot_b64,
    }


async def click_at(x: int, y: int) -> dict:
    """
    Click at pixel coordinates (x, y) on the current page.
    Returns updated page text and screenshot after the click.

    Args:
        x: Horizontal pixel coordinate.
        y: Vertical pixel coordinate.
    """
    page = await _get_page()
    await page.mouse.click(x, y)
    await page.wait_for_timeout(1000)

    text           = await _extract_text(page)
    screenshot_b64 = await _screenshot_b64(page)

    return {
        "url":        page.url,
        "text":       text[:4000],
        "screenshot": screenshot_b64,
    }


async def scroll_to_text(query: str) -> dict:
    """
    Scroll the page until text matching the query is visible.
    Returns the visible text and a screenshot once found.

    Args:
        query: The text string to search for and scroll to.
    """
    page = await _get_page()

    # Try to locate and scroll the element into view
    try:
        locator = page.get_by_text(query, exact=False).first
        await locator.scroll_into_view_if_needed(timeout=5000)
        await page.wait_for_timeout(500)
        found = True
    except Exception:
        found = False

    text           = await _extract_text(page)
    screenshot_b64 = await _screenshot_b64(page)

    return {
        "found":      found,
        "url":        page.url,
        "text":       text[:4000],
        "screenshot": screenshot_b64,
    }


async def summarize_page() -> dict:
    """
    Return a clean text summary of the currently loaded page without taking
    a new screenshot. Useful for reading article content.
    """
    page = await _get_page()
    text = await _extract_text(page)
    return {
        "url":   page.url,
        "title": await page.title(),
        "text":  text[:6000],
    }

# ── Private helpers ───────────────────────────────────────────────────────────

async def _extract_text(page: Page) -> str:
    """Extract readable text from the page, stripping nav/footer noise."""
    return await page.evaluate("""() => {
        const selectors = ['article', 'main', '.content', '#content', 'body']
        for (const sel of selectors) {
            const el = document.querySelector(sel)
            if (el && el.innerText.trim().length > 200) return el.innerText.trim()
        }
        return document.body.innerText.trim()
    }""")


async def _screenshot_b64(page: Page) -> str:
    """Return a base64-encoded JPEG screenshot of the current page."""
    raw = await page.screenshot(type="jpeg", quality=70)
    return base64.b64encode(raw).decode()

# ADK accepts plain Python functions directly as tools — no wrapper needed.
# agent.py imports: navigate, click_at, scroll_to_text, summarize_page
