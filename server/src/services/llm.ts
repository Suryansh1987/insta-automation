import { AzureOpenAI } from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

interface ScrapedPost {
  caption: string;
  likes: number | null;
  comments: number | null;
}

const SYSTEM_PROMPT = `You are writing a warm, genuine Instagram DM on behalf of a real person reaching out to another creator.

Rules:
- 3–5 short paragraphs, conversational tone, no em-dashes
- Open by referencing a specific insight or phrase from one of their recent posts
- Show you actually understood the content — quote or closely paraphrase a detail
- Add a brief personal reaction ("This shifted something for me", "I hadn't thought of it that way", etc.)
- Close with gratitude and sign off with just the sender's first name
- Do NOT use generic openers like "I love your content" or "great post"
- Do NOT use hashtags, emojis, or sales language
- Do NOT mention following, collabs, or any ask — this is purely a genuine appreciation message`;

function pickBestPost(posts: ScrapedPost[]): ScrapedPost | null {
  if (posts.length === 0) return null;
  return posts.reduce((best, p) => {
    const score = (p.likes ?? 0) + (p.comments ?? 0) * 5;
    const bestScore = (best.likes ?? 0) + (best.comments ?? 0) * 5;
    return score > bestScore ? p : best;
  });
}

export async function generatePersonalizedMessage(
  posts: ScrapedPost[],
  bio: string,
  profileScreenshotBase64: string | undefined,
  senderName: string,
): Promise<{ message: string | null; tokenCount: number }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-03-01-preview";

  if (!endpoint || !apiKey) return { message: null, tokenCount: 0 };

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

  const bestPost = pickBestPost(posts);
  const otherPosts = posts.filter((p) => p !== bestPost);

  const engagementLabel = bestPost
    ? [
        bestPost.likes != null ? `${bestPost.likes.toLocaleString()} likes` : null,
        bestPost.comments != null ? `${bestPost.comments} comments` : null,
      ]
        .filter(Boolean)
        .join(", ") || "engagement hidden"
    : "";

  const focusBlock = bestPost
    ? `FOCUS POST (${engagementLabel} — base the message primarily on this one):\n${bestPost.caption}`
    : "";

  const contextBlock =
    otherPosts.length > 0
      ? `\nOther recent posts for additional context:\n${otherPosts.map((p, i) => `Post ${i + 2}:\n${p.caption}`).join("\n\n---\n\n")}`
      : "";

  const bioLine = bio ? `Their bio: "${bio}"\n\n` : "";
  const screenshotLine = profileScreenshotBase64
    ? "A screenshot of their profile is attached — use the visual aesthetic, style, and setting to enrich the message.\n\n"
    : "";

  const textPrompt = `Write a hyper-personalized Instagram DM based on the posts below.\n${bioLine}${screenshotLine}${focusBlock}\n${contextBlock}\n\nSign off with the name: ${senderName}`;

  const userContent: ChatCompletionContentPart[] = [];

  if (profileScreenshotBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${profileScreenshotBase64}`, detail: "low" },
    });
  }

  userContent.push({ type: "text", text: textPrompt });

  try {
    const response = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 400,
      temperature: 0.85,
    });

    return {
      message: response.choices[0]?.message?.content?.trim() || null,
      tokenCount: response.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    console.warn(`[llm] Azure OpenAI call failed: ${(err as Error).message}`);
    return { message: null, tokenCount: 0 };
  }
}
