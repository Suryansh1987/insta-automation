import { AzureOpenAI } from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

interface ScrapedPost {
  caption: string;
  likes: number | null;
  comments: number | null;
  postedAt?: Date;
  postId?: string;
}

function buildSystemPrompt(tone?: string, customPrompt?: string): string {
  const toneInstruction = tone?.trim()
    ? `Use a ${tone.trim()} tone`
    : "Write as a real person sharing a genuine realization";

  const extraPrompt = customPrompt?.trim()
    ? `\n\nAdditional instructions:\n${customPrompt.trim()}`
    : "";

  return `You are writing a first Instagram DM to someone whose content genuinely landed with you. You're not selling anything. You're just showing them the thought you put into what they shared.

Structure — 2–3 paragraphs:

Paragraph 1: The specific idea or observation that stood out. Name the exact thing (a quote, a concept, a reframe they introduced). Explain what made it stick — don't say "inspiring" or "powerful", show what shifted in your thinking because of it.

Paragraph 2 (optional but stronger): Go deeper. How did this land for you specifically? What does it unlock or change about how you see something? This shows you didn't just skim — you actually sat with the idea.

Paragraph 3: A brief, genuine closer. Thank them if it lands naturally. Keep it short and real. Can end with just your name.

Rules:
- ${toneInstruction}
- Specificity is everything. Reference actual phrases or concepts from their post, not generic praise
- Never open with compliments ("amazing", "love your content", "inspiring")
- No emojis, no hashtags, no selling, no collab hints
- Sound like a peer who thinks, not a fan
- 2–3 short paragraphs max
- Natural, conversational language — how you'd text a smart friend${extraPrompt}`;
}

function formatTimeAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function pickBestPost(posts: ScrapedPost[]): ScrapedPost | null {
  if (posts.length === 0) return null;

  return posts.reduce((best, p) => {
    // Use post date or default to now
    const postDate = p.postedAt ?? new Date();
    const bestDate = best.postedAt ?? new Date();

    // Calculate recency score (higher for recent posts)
    const daysSincePost = (Date.now() - postDate.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 30 - daysSincePost); // Last 30 days get points

    // Calculate engagement score
    const engagementScore = (p.likes ?? 0) + (p.comments ?? 0) * 3;

    // Total score: engagement + recency bonus
    const totalScore = engagementScore + recencyScore * 5;

    // Calculate best post score
    const bestDaysSincePost = (Date.now() - bestDate.getTime()) / (1000 * 60 * 60 * 24);
    const bestRecencyScore = Math.max(0, 30 - bestDaysSincePost);
    const bestEngagementScore = (best.likes ?? 0) + (best.comments ?? 0) * 3;
    const bestTotalScore = bestEngagementScore + bestRecencyScore * 5;

    return totalScore > bestTotalScore ? p : best;
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

  // Format engagement label
  const engagementLabel = bestPost
    ? [
        bestPost.likes != null ? `${bestPost.likes.toLocaleString()} likes` : null,
        bestPost.comments != null ? `${bestPost.comments} comments` : null,
      ]
        .filter(Boolean)
        .join(", ") || "engagement hidden"
    : "";

  // Build focus block with timestamp (if available)
  const focusBlock = bestPost
    ? `FOCUS POST (${engagementLabel}${bestPost.postedAt ? `, posted ${formatTimeAgo(bestPost.postedAt)}` : ""} - base the message primarily on this one):\n${bestPost.caption || "(caption empty)"}`
    : "";

  // Build context block with chronological ordering
  const contextBlock =
    otherPosts.length > 0
      ? `\nOther recent posts for additional context:\n${otherPosts
          .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0))
          .map(
            (p, i) =>
              `Post ${i + 2}${p.postedAt ? ` (posted ${formatTimeAgo(p.postedAt)})` : ""}:\n${p.caption || "(caption empty)"}`,
          )
          .join("\n\n---\n\n")}`
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