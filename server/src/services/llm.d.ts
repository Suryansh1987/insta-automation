interface ScrapedPost {
    caption: string;
    likes: number | null;
    comments: number | null;
}
export declare function generatePersonalizedMessage(posts: ScrapedPost[], bio: string, profileScreenshotBase64: string | undefined, senderName: string): Promise<{
    message: string | null;
    tokenCount: number;
}>;
export {};
//# sourceMappingURL=llm.d.ts.map