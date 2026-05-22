import { AzureOpenAI } from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

interface ScrapedPost {
  caption: string;
  likes: number | null;
  comments: number | null;
}

function buildSystemPrompt(tone?: string, customPrompt?: string): string {
  const toneInstruction = tone?.trim()
    ? `- Use a ${tone.trim()} tone while still sounding natural and human`
    : "- Sound like a curious, real person — not a fan account";

  const extraPrompt = customPrompt?.trim()
    ? `\nAdditional user instructions:\n${customPrompt.trim()}`
    : "";

  return `You are writing a first Instagram DM on behalf of a real person. The goal is to get a reply by combining a genuine specific compliment with a question that makes them want to respond.

Structure — two short paragraphs:
Paragraph 1 (compliment): A specific, genuine compliment referencing ONE concrete detail from their posts — a phrase they used, a technique, a visual choice, something that stood out. Show you actually paid attention. Never say "love your content", "great post", "amazing" — it must be tied to something specific they did.
Paragraph 2 (question): A single genuine question about THEIR experience, process, or thinking behind that specific thing. It must feel like innocent curiosity from a fan/admirer — never like you need something from them, never like you're about to pitch or buy something. It should be the kind of question a curious follower would ask, not a potential client or partner.

Additional rules:
${toneInstruction}
- The two paragraphs should feel connected — the question flows from the compliment
- No hashtags, no emojis, no selling, no collab asks
- Sign off with the provided sender name${extraPrompt}`;
}

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
  tone?: string,
  customPrompt?: string,
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
    ? `FOCUS POST (${engagementLabel} - base the message primarily on this one):\n${bestPost.caption}`
    : "";

  const contextBlock =
    otherPosts.length > 0
      ? `\nOther recent posts for additional context:\n${otherPosts.map((p, i) => `Post ${i + 2}:\n${p.caption}`).join("\n\n---\n\n")}`
      : "";

  const bioLine = bio ? `Their bio: "${bio}"\n\n` : "";
  const screenshotLine = profileScreenshotBase64
    ? "A screenshot of their profile is attached - use the visual aesthetic, style, and setting to enrich the message.\n\n"
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
        { role: "system", content: buildSystemPrompt(tone, customPrompt) },
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
