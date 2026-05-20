import type { PersonalizeRequest, PersonalizeResponse } from "@insta-saas/shared";
import type { ScrapeResult } from "../instagram/scraper";

export interface PersonalizerConfig {
  serverUrl: string;
  authToken: string;
}

export async function generatePersonalizedMessage(
  scrapeResult: ScrapeResult,
  config: PersonalizerConfig,
): Promise<{ message: string | null; tokenCount: number }> {
  const { posts, bio, profileScreenshot } = scrapeResult;
  if (posts.length === 0) return { message: null, tokenCount: 0 };

  const body: PersonalizeRequest = {
    posts,
    bio,
    profileScreenshot: profileScreenshot?.toString("base64"),
  };

  try {
    const res = await fetch(`${config.serverUrl}/automation/personalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { message: null, tokenCount: 0 };
    }

    const data = (await res.json()) as PersonalizeResponse;
    return { message: data.message, tokenCount: data.tokenCount ?? 0 };
  } catch {
    return { message: null, tokenCount: 0 };
  }
}
