import fs from "node:fs";
import path from "node:path";
import { BrowserContext, Locator, Page, chromium } from "playwright";
import { ScrapeProgressEvent, ScrapeResult, scrapeProfile } from "./scraper";

export interface ClientConfig {
  sessionDir: string;
  headless?: boolean; // false = manual-login mode (visible browser)
}

export type SendMessageResult = {
  status: "sent" | "failed" | "user_not_found" | "dm_disabled";
  error?: string;
};

export type ConversationCheckResult = {
  seen: boolean;
  replied: boolean;
  replyPreview?: string;
};

export type ClientProgressEvent = {
  workflow: "send" | "analyze";
  stageId: string;
  label: string;
  state: "active" | "done" | "error";
  detail?: string;
  username: string;
};

export class InstagramClient {
  private context?: BrowserContext;
  private page?: Page;

  constructor(private config: ClientConfig) {}

  async init(): Promise<void> {
    const userDataDir = path.resolve(this.config.sessionDir);
    const headless = this.config.headless ?? true;
    fs.mkdirSync(userDataDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
    });

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.ensureLoggedIn();
  }

  async close(): Promise<void> {
    await this.context?.close();
  }

  private async ensureLoggedIn(): Promise<void> {
    const page = this.requirePage();

    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
    await this.dismissCookieBanner(page);

    const authenticated = await this.isAuthenticated(page);

    if (authenticated) {
      await this.dismissOptionalPrompts(page);
      return;
    }

    if (this.config.headless !== false) {
      throw new Error(
        "Instagram session not found or expired. " +
          "Go to Accounts and click 'Login' to authenticate via the browser.",
      );
    }

    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });
    await this.dismissCookieBanner(page);
    await this.waitForManualLogin(page, 5 * 60 * 1_000);
    await this.dismissOptionalPrompts(page);
  }

  private async waitForManualLogin(page: Page, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.isAuthenticated(page)) return;
      await page.waitForTimeout(2_000);
    }
    throw new Error("Manual login timed out after 5 minutes. Please try again.");
  }

  async scrapeUserPosts(
    username: string,
    limit = 3,
    onProgress?: (event: ClientProgressEvent) => void,
  ): Promise<ScrapeResult & { messageable: boolean }> {
    const page = this.requirePage();
    onProgress?.({ workflow: "send", stageId: "open_profile", label: "Opening profile", state: "active", detail: `Loading @${username}`, username });
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    await this.dismissProfileLoginModal(page);
    onProgress?.({ workflow: "send", stageId: "open_profile", label: "Opening profile", state: "done", detail: `Opened @${username}`, username });

    const messageable = (await this.findMessageAction(page).count()) > 0;
    if (!messageable) {
      return { posts: [], bio: "", profileScreenshot: null, messageable: false };
    }

    const result = await scrapeProfile(page, limit, (event: ScrapeProgressEvent) => {
      onProgress?.({
        workflow: "send",
        stageId: event.stageId,
        label: event.label,
        state: event.state,
        detail: event.detail,
        username,
      });
    });
    return { ...result, messageable: true };
  }

  async sendMessage(
    username: string,
    message: string,
    onProgress?: (event: ClientProgressEvent) => void,
  ): Promise<SendMessageResult> {
    const page = this.requirePage();

    try {
      onProgress?.({ workflow: "send", stageId: "send_message", label: "Opening message composer", state: "active", detail: `Preparing DM for @${username}`, username });
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);
      await this.dismissProfileLoginModal(page);

      if (!(await this.isAuthenticatedOnProfilePage(page))) {
        return { status: "failed", error: "Instagram session expired. Please restart the worker." };
      }

      if (await this.isNotFoundPage(page)) {
        return { status: "user_not_found", error: "User profile not found." };
      }

      const messageButton = this.findMessageAction(page);
      if ((await messageButton.count()) === 0) {
        return { status: "dm_disabled", error: "Message button not available on profile." };
      }

      await messageButton.click();
      await page.waitForTimeout(2_500);

      if (await this.isDmBlocked(page)) {
        return { status: "dm_disabled", error: "DM is disabled or restricted for this user." };
      }

      const textbox = page.locator("div[role='textbox']").last();
      await textbox.click();
      await textbox.fill(message);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);
      onProgress?.({ workflow: "send", stageId: "send_message", label: "Sending message", state: "done", detail: `Message sent to @${username}`, username });

      return { status: "sent" };
    } catch (error) {
      onProgress?.({
        workflow: "send",
        stageId: "send_message",
        label: "Sending message",
        state: "error",
        detail: error instanceof Error ? error.message : "Unknown Playwright error",
        username,
      });
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown Playwright error",
      };
    }
  }

  private async isAuthenticated(page: Page): Promise<boolean> {
    const selectors = [
      "svg[aria-label='Home']",
      "a[href='/direct/inbox/']",
      "svg[aria-label='Search']",
      "svg[aria-label='New post']",
      "a[href='/explore/']",
    ];
    for (const selector of selectors) {
      if ((await page.locator(selector).count()) > 0) return true;
    }
    return false;
  }

  private async isAuthenticatedOnProfilePage(page: Page): Promise<boolean> {
    if (await this.isAuthenticated(page)) return true;
    if (page.url().includes("/accounts/login")) return false;
    const topLoginButton = page
      .locator("header button:has-text('Log in'), header a:has-text('Log in')")
      .first();
    if ((await topLoginButton.count()) > 0) return false;
    return true;
  }

  private async dismissProfileLoginModal(page: Page): Promise<void> {
    const closeButton = page
      .locator(
        [
          "div[role='dialog'] button:has(svg[aria-label='Close'])",
          "div[role='dialog'] [aria-label='Close']",
        ].join(","),
      )
      .first();
    if ((await closeButton.count()) > 0) {
      await closeButton.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  private async dismissCookieBanner(page: Page): Promise<void> {
    const cookieButton = page
      .locator(
        [
          "button:has-text('Allow all cookies')",
          "button:has-text('Allow essential and optional cookies')",
          "button:has-text('Accept All')",
          "button:has-text('Accept')",
        ].join(","),
      )
      .first();
    if ((await cookieButton.count()) > 0) {
      await cookieButton.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  private async dismissOptionalPrompts(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      const notNowButton = page.getByRole("button", { name: /not now/i }).first();
      if ((await notNowButton.count()) > 0) {
        await notNowButton.click().catch(() => undefined);
        await page.waitForTimeout(1_500);
      } else {
        break;
      }
    }
  }

  private async hasCredentialLoginForm(page: Page): Promise<boolean> {
    const usernameInput = page.locator(
      ["input[name='username']", "input[name='email']", "input[autocomplete*='username']"].join(","),
    );
    const passwordInput = page.locator(
      ["input[name='password']", "input[type='password']"].join(","),
    );
    return (await usernameInput.count()) > 0 && (await passwordInput.count()) > 0;
  }

  private async isNotFoundPage(page: Page): Promise<boolean> {
    return (await page.getByText("Sorry, this page isn't available.").count()) > 0;
  }

  private async isDmBlocked(page: Page): Promise<boolean> {
    const signals = ["You can't message this account", "You can only send messages to people who follow you"];
    for (const signal of signals) {
      if ((await page.getByText(signal, { exact: false }).count()) > 0) return true;
    }
    return false;
  }

  private findMessageAction(page: Page): Locator {
    return page
      .locator("main")
      .locator(["button:has-text('Message')", "div[role='button']:has-text('Message')"].join(","))
      .first();
  }

  async checkConversation(
    username: string,
    onProgress?: (event: ClientProgressEvent) => void,
  ): Promise<ConversationCheckResult> {
    const page = this.requirePage();

    try {
      onProgress?.({ workflow: "analyze", stageId: "open_profile", label: "Opening profile", state: "active", detail: `Loading @${username}`, username });
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);
      await this.dismissProfileLoginModal(page);
      onProgress?.({ workflow: "analyze", stageId: "open_profile", label: "Opening profile", state: "done", detail: `Opened @${username}`, username });

      const msgBtn = this.findMessageAction(page);
      if ((await msgBtn.count()) === 0) {
        onProgress?.({ workflow: "analyze", stageId: "open_thread", label: "Opening chat", state: "error", detail: "Message button not available", username });
        return { seen: false, replied: false };
      }

      onProgress?.({ workflow: "analyze", stageId: "open_thread", label: "Opening chat", state: "active", detail: `Opening thread with @${username}`, username });
      await msgBtn.click();
      await page.waitForTimeout(3_500);
      await this.dismissOptionalPrompts(page);

      const threadOpen = await page
        .waitForFunction(
          () => {
            if (window.location.href.includes("/direct/")) return true;
            if (document.querySelector("div[role='textbox']")) return true;
            if (document.querySelector("div[role='row']")) return true;
            return false;
          },
          undefined,
          { timeout: 10_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!threadOpen) {
        onProgress?.({ workflow: "analyze", stageId: "open_thread", label: "Opening chat", state: "error", detail: "Thread did not open", username });
        return { seen: false, replied: false };
      }
      onProgress?.({ workflow: "analyze", stageId: "open_thread", label: "Opening chat", state: "done", detail: "Thread opened", username });

      onProgress?.({ workflow: "analyze", stageId: "read_conversation", label: "Reading conversation", state: "active", detail: "Scrolling to latest messages", username });
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("*"));
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.scrollHeight > node.clientHeight + 40) {
            node.scrollTop = node.scrollHeight;
          }
        }
      }).catch(() => undefined);
      await page.waitForTimeout(800);
      onProgress?.({ workflow: "analyze", stageId: "read_conversation", label: "Reading conversation", state: "done", detail: "Latest messages loaded", username });

      onProgress?.({ workflow: "analyze", stageId: "check_reply", label: "Checking reply", state: "active", detail: "Scanning visible bubbles", username });
      const replyInfo = await page.evaluate((targetUsername) => {
        let scope: HTMLElement | null = null;
        let composerRect: DOMRect | null = null;

        const directTextbox =
          document.querySelector("div[role='textbox']") ??
          document.querySelector("[contenteditable='true'][aria-label]") ??
          document.querySelector("textarea[placeholder]") ??
          document.querySelector("input[placeholder]");

        if (directTextbox instanceof HTMLElement) {
          composerRect = directTextbox.getBoundingClientRect();
          let current: HTMLElement | null = directTextbox;
          let best: HTMLElement | null = null;
          while (current && current !== document.body) {
            const rect = current.getBoundingClientRect();
            if (
              rect.width >= 240 &&
              rect.height >= 220 &&
              rect.width <= 520 &&
              rect.left >= window.innerWidth * 0.55 &&
              rect.top >= window.innerHeight * 0.35
            ) {
              best = current;
            }
            current = current.parentElement;
          }
          scope = best;
        }

        if (!scope) {
          const panels = Array.from(document.querySelectorAll("div, section"));
          for (const panel of panels) {
            if (!(panel instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(panel);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

            const rect = panel.getBoundingClientRect();
            if (rect.width < 220 || rect.height < 180) continue;
            if (rect.left < window.innerWidth * 0.55) continue;
            if (rect.top < window.innerHeight * 0.45) continue;

            const text = (panel.textContent ?? "").toLowerCase();
            const className = panel.className;
            const hasUsername = text.includes(targetUsername.toLowerCase());
            const hasComposer =
              panel.querySelector("div[role='textbox']") ||
              panel.querySelector("[contenteditable='true']") ||
              panel.querySelector("textarea") ||
              panel.querySelector("input[placeholder]") ||
              text.includes("message...");
            const hasKnownClass =
              typeof className === "string" &&
              (className.includes("x16ye13r") || className.includes("x135b78x") || className.includes("x1ys307a"));

            if ((hasUsername && hasComposer) || hasKnownClass) {
              scope = panel;
              break;
            }
          }
        }

        if (!scope) scope = document.body;

        const candidates = Array.from(scope.querySelectorAll("div[dir='auto'], span, p"));
        const textBlocks: Array<{ text: string; top: number; left: number; right: number; centerX: number }> = [];

        const laneLeft = composerRect ? Math.max(0, composerRect.left - 120) : window.innerWidth * 0.72;
        const laneRight = composerRect ? Math.min(window.innerWidth, composerRect.right + 24) : window.innerWidth;
        const laneTop = composerRect ? Math.max(0, composerRect.top - 520) : 120;
        const laneBottom = composerRect ? Math.min(window.innerHeight, composerRect.bottom + 24) : window.innerHeight;

        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement)) continue;

          const style = window.getComputedStyle(candidate);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
            continue;
          }

          const text = (candidate.textContent ?? "").trim().replace(/\s+/g, " ");
          if (!text) continue;
          if (/^Seen\b/i.test(text)) continue;
          if (/^Write a message/i.test(text)) continue;
          if (/^Search/i.test(text)) continue;
          if (/^Messages$/i.test(text)) continue;
          if (/^Message\.\.\.$/i.test(text)) continue;

          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.bottom < laneTop || rect.top > laneBottom) continue;
          if (rect.right < laneLeft || rect.left > laneRight) continue;

          let duplicate = false;
          for (const existing of textBlocks) {
            if (
              existing.text === text &&
              Math.abs(existing.top - Math.round(rect.top)) <= 4 &&
              Math.abs(existing.left - Math.round(rect.left)) <= 4
            ) {
              duplicate = true;
              break;
            }
          }
          if (duplicate) continue;

          textBlocks.push({
            text,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            centerX: rect.left + rect.width / 2,
          });
        }

        textBlocks.sort((a, b) => (a.top - b.top) || (a.left - b.left));

        const scopeRect = scope.getBoundingClientRect();
        const leftCutoff = composerRect ? composerRect.left + 24 : laneLeft + (laneRight - laneLeft) * 0.3;
        const rightCutoff = composerRect ? composerRect.right - 24 : laneLeft + (laneRight - laneLeft) * 0.7;
        let lastOutboundIdx = -1;

        for (let i = 0; i < textBlocks.length; i += 1) {
          if (textBlocks[i].right >= rightCutoff) lastOutboundIdx = i;
        }

        if (lastOutboundIdx === -1) {
          return {
            replied: false,
            scopeTextCount: textBlocks.length,
            scopeRect: {
              left: Math.round(scopeRect.left),
              top: Math.round(scopeRect.top),
              width: Math.round(scopeRect.width),
              height: Math.round(scopeRect.height),
            },
            laneRect: {
              left: Math.round(laneLeft),
              right: Math.round(laneRight),
              top: Math.round(laneTop),
              bottom: Math.round(laneBottom),
            },
            leftCutoff: Math.round(leftCutoff),
            rightCutoff: Math.round(rightCutoff),
            lastOutboundIdx,
            textBlocks,
          };
        }

        for (let i = lastOutboundIdx + 1; i < textBlocks.length; i += 1) {
          if (textBlocks[i].left <= leftCutoff) {
            return {
              replied: true,
              replyPreview: textBlocks[i].text.slice(0, 120),
              scopeTextCount: textBlocks.length,
              scopeRect: {
                left: Math.round(scopeRect.left),
                top: Math.round(scopeRect.top),
                width: Math.round(scopeRect.width),
                height: Math.round(scopeRect.height),
              },
              laneRect: {
                left: Math.round(laneLeft),
                right: Math.round(laneRight),
                top: Math.round(laneTop),
                bottom: Math.round(laneBottom),
              },
              leftCutoff: Math.round(leftCutoff),
              rightCutoff: Math.round(rightCutoff),
              lastOutboundIdx,
              textBlocks,
            };
          }
        }

        return {
          replied: false,
          scopeTextCount: textBlocks.length,
          scopeRect: {
            left: Math.round(scopeRect.left),
            top: Math.round(scopeRect.top),
            width: Math.round(scopeRect.width),
            height: Math.round(scopeRect.height),
          },
          laneRect: {
            left: Math.round(laneLeft),
            right: Math.round(laneRight),
            top: Math.round(laneTop),
            bottom: Math.round(laneBottom),
          },
          leftCutoff: Math.round(leftCutoff),
          rightCutoff: Math.round(rightCutoff),
          lastOutboundIdx,
          textBlocks,
        };
      }, username);
      onProgress?.({
        workflow: "analyze",
        stageId: "check_reply",
        label: "Checking reply",
        state: "done",
        detail: replyInfo.replied ? `Reply found: ${replyInfo.replyPreview ?? "yes"}` : "No reply detected",
        username,
      });

      onProgress?.({ workflow: "analyze", stageId: "check_seen", label: "Checking seen status", state: "active", detail: "Looking for seen marker", username });
      const seen = await page.evaluate((targetUsername) => {
        let scope: HTMLElement | null = null;

        const directTextbox =
          document.querySelector("div[role='textbox']") ??
          document.querySelector("[contenteditable='true'][aria-label]") ??
          document.querySelector("textarea[placeholder]") ??
          document.querySelector("input[placeholder]");

        if (directTextbox instanceof HTMLElement) {
          let current: HTMLElement | null = directTextbox;
          let best: HTMLElement | null = null;
          while (current && current !== document.body) {
            const rect = current.getBoundingClientRect();
            if (
              rect.width >= 240 &&
              rect.height >= 220 &&
              rect.width <= 520 &&
              rect.left >= window.innerWidth * 0.55 &&
              rect.top >= window.innerHeight * 0.35
            ) {
              best = current;
            }
            current = current.parentElement;
          }
          scope = best;
        }

        if (!scope) {
          const panels = Array.from(document.querySelectorAll("div, section"));
          for (const panel of panels) {
            if (!(panel instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(panel);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

            const rect = panel.getBoundingClientRect();
            if (rect.width < 220 || rect.height < 180) continue;
            if (rect.left < window.innerWidth * 0.55) continue;
            if (rect.top < window.innerHeight * 0.45) continue;

            const text = (panel.textContent ?? "").toLowerCase();
            const className = panel.className;
            const hasUsername = text.includes(targetUsername.toLowerCase());
            const hasComposer =
              panel.querySelector("div[role='textbox']") ||
              panel.querySelector("[contenteditable='true']") ||
              panel.querySelector("textarea") ||
              panel.querySelector("input[placeholder]") ||
              text.includes("message...");
            const hasKnownClass =
              typeof className === "string" &&
              (className.includes("x16ye13r") || className.includes("x135b78x") || className.includes("x1ys307a"));

            if ((hasUsername && hasComposer) || hasKnownClass) {
              scope = panel;
              break;
            }
          }
        }

        if (!scope) scope = document.body;
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (/^Seen\b/i.test(node.textContent?.trim() ?? "")) return true;
        }
        return false;
      }, username);
      onProgress?.({
        workflow: "analyze",
        stageId: "check_seen",
        label: "Checking seen status",
        state: "done",
        detail: seen || replyInfo.replied ? "Conversation appears seen" : "Seen marker not found",
        username,
      });

      const finalSeen = seen || replyInfo.replied;

      if (!finalSeen && !replyInfo.replied) {
        await this.captureLoginDebug(page, `check-${username}`);
        await this.captureCheckDebug(`check-${username}`, {
          username,
          url: page.url(),
          seen,
          finalSeen,
          replyInfo,
        });
      }

      return {
        seen: finalSeen,
        replied: replyInfo.replied,
        replyPreview: replyInfo.replyPreview,
      };
    } catch (err) {
      onProgress?.({
        workflow: "analyze",
        stageId: "read_conversation",
        label: "Reading conversation",
        state: "error",
        detail: err instanceof Error ? err.message : String(err),
        username,
      });
      return { seen: false, replied: false };
    }
  }

  private async captureLoginDebug(page: Page, tag: string): Promise<void> {
    const logsDir = path.resolve(this.config.sessionDir, "../logs");
    fs.mkdirSync(logsDir, { recursive: true });

    const stamp = Date.now();
    const htmlPath = path.join(logsDir, `${tag}-${stamp}.html`);
    const pngPath = path.join(logsDir, `${tag}-${stamp}.png`);

    await fs.promises.writeFile(htmlPath, await page.content(), "utf8");
    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => undefined);
  }

  private async captureCheckDebug(tag: string, details: unknown): Promise<void> {
    const logsDir = path.resolve(this.config.sessionDir, "../logs");
    fs.mkdirSync(logsDir, { recursive: true });

    const stamp = Date.now();
    const jsonPath = path.join(logsDir, `${tag}-${stamp}.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(details, null, 2), "utf8");
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("Instagram client not initialized. Call init() first.");
    return this.page;
  }
}
