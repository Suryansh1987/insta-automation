import { Page } from "playwright";

export interface ScrapedPost {
  caption: string;
  likes: number | null;
  comments: number | null;
}

export interface ScrapeResult {
  posts: ScrapedPost[];
  bio: string;
  profileScreenshot: Buffer | null;
}

export interface ScrapeProgressEvent {
  stageId: "scroll_profile" | "check_bio" | "capture_screenshot" | "check_likes";
  label: string;
  state: "active" | "done";
  detail?: string;
}

export async function scrapeProfile(
  page: Page,
  limit = 3,
  onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<ScrapeResult> {
  const profileUrl = page.url();

  await page
    .waitForSelector("a[href*='/p/'], a[href*='/reel/']", { timeout: 8_000 })
    .catch(() => {});

  onProgress?.({ stageId: "scroll_profile", label: "Scrolling profile", state: "active", detail: "Loading recent posts" });
  await page.evaluate(() => window.scrollTo({ top: Math.min(window.innerHeight * 0.8, document.body.scrollHeight), behavior: "instant" as ScrollBehavior })).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })).catch(() => undefined);
  await page.waitForTimeout(500);
  onProgress?.({ stageId: "scroll_profile", label: "Scrolling profile", state: "done", detail: "Recent content loaded" });

  onProgress?.({ stageId: "check_bio", label: "Checking description", state: "active" });
  const bio = await scrapeBio(page);
  onProgress?.({ stageId: "check_bio", label: "Checking description", state: "done", detail: bio ? "Description captured" : "No description found" });

  let profileScreenshot: Buffer | null = null;
  onProgress?.({ stageId: "capture_screenshot", label: "Taking screenshot", state: "active" });
  try {
    profileScreenshot = await page.screenshot({ fullPage: false });
  } catch {
    // continue without screenshot
  }
  onProgress?.({
    stageId: "capture_screenshot",
    label: "Taking screenshot",
    state: "done",
    detail: profileScreenshot ? "Profile screenshot captured" : "Screenshot skipped",
  });

  const hrefs: string[] = await page.evaluate((max: number) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
      const href = a.getAttribute("href") ?? "";
      if ((href.includes("/p/") || href.includes("/reel/")) && !seen.has(href)) {
        seen.add(href);
        result.push(href);
        if (result.length >= max) break;
      }
    }
    return result;
  }, limit);

  onProgress?.({
    stageId: "check_likes",
    label: "Checking likes and posts",
    state: "active",
    detail: hrefs.length > 0 ? `${hrefs.length} recent post(s) found` : "No recent posts found",
  });

  const posts: ScrapedPost[] = [];

  for (let i = 0; i < hrefs.length; i += 1) {
    const href = hrefs[i];
    try {
      const thumb = page.locator(`a[href="${href}"]`).first();
      await thumb.click();

      await page.waitForURL((u) => u.toString().includes("/p/") || u.toString().includes("/reel/"), {
        timeout: 8_000,
      });
      await page.waitForTimeout(1_500);

      const caption = await extractCaption(page);
      const likes = await extractLikes(page);
      const comments = await extractComments(page);

      posts.push({ caption, likes, comments });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
    } catch {
      await page.goto(profileUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1_500);
    }
  }

  onProgress?.({
    stageId: "check_likes",
    label: "Checking likes and posts",
    state: "done",
    detail: posts.length > 0 ? `${posts.length} post(s) analyzed` : "No posts analyzed",
  });

  return { posts, bio, profileScreenshot };
}

async function scrapeBio(page: Page): Promise<string> {
  const bio: string = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return "";
    const candidates = Array.from(
      header.querySelectorAll("span[dir='auto'], div[dir='auto']"),
    ) as HTMLElement[];
    const texts = candidates
      .map((el) => el.innerText?.trim() ?? "")
      .filter((t) => t.length > 5 && t.length < 300 && !/^\d/.test(t));
    return texts[0] ?? "";
  });
  return bio;
}

async function extractLikes(page: Page): Promise<number | null> {
  const raw: string | null = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("span, button, a")) as HTMLElement[];
    for (const el of els) {
      const t = el.innerText?.trim() ?? "";
      if (/^[\d,\.]+[KkMm]?\s*(likes?|like)$/i.test(t)) return t;
      if (/liked by .+ and ([\d,]+) others?/i.test(t)) return t;
    }
    return null;
  });

  if (!raw) return null;
  const othersMatch = raw.match(/and ([\d,]+) others?/i);
  if (othersMatch) return parseInt(othersMatch[1].replace(/,/g, ""), 10);
  return parseSocialCount(raw.split(/\s/)[0]);
}

async function extractComments(page: Page): Promise<number | null> {
  const raw: string | null = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("span, a, button")) as HTMLElement[];
    for (const el of els) {
      const t = el.innerText?.trim() ?? "";
      if (/view all [\d,]+ comments?/i.test(t)) return t;
      if (/^[\d,]+\s+comments?$/i.test(t)) return t;
    }
    return null;
  });

  if (!raw) return null;
  const match = raw.match(/[\d,]+/);
  return match ? parseInt(match[0].replace(/,/g, ""), 10) : null;
}

function parseSocialCount(text: string): number | null {
  const match = text.match(/^([\d,\.]+)([KkMm]?)$/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  const suffix = match[2].toUpperCase();
  if (suffix === "K") return Math.round(num * 1_000);
  if (suffix === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
}

function looksLikeCaption(text: string): boolean {
  if (text.length < 40) return false;
  if (/^https?:\/\/|^www\.|^\S+\.\S+\//.test(text)) return false;
  return true;
}

async function extractCaption(page: Page): Promise<string> {
  const dialog = page.locator("div[role='dialog']");
  const dialogCount = await dialog.count();
  const scope = dialogCount > 0 ? dialog.first() : page.locator("body");

  const h1s = scope.locator("h1[dir='auto']");
  const h1Count = await h1s.count();
  for (let i = 0; i < h1Count; i += 1) {
    const text = (await h1s.nth(i).innerText({ timeout: 2_000 }).catch(() => "")).trim();
    if (looksLikeCaption(text)) return text;
  }

  const dirAuto = scope.locator("span[dir='auto'], div[dir='auto']");
  const n = await dirAuto.count();
  for (let i = 0; i < Math.min(n, 15); i += 1) {
    const text = (await dirAuto.nth(i).innerText({ timeout: 2_000 }).catch(() => "")).trim();
    if (looksLikeCaption(text)) return text;
  }

  const best: string = await scope.evaluate((root) => {
    const els = Array.from(root.querySelectorAll("h1, h2, p, span[dir], div[dir]")) as HTMLElement[];
    return els
      .map((el) => el.innerText?.trim() ?? "")
      .filter((t) => t.length >= 40 && !/^https?:\/\/|^www\./.test(t))
      .reduce((a, b) => (b.length > a.length ? b : a), "");
  });

  return best;
}
