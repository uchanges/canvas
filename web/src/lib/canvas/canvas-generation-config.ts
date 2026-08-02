import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";

export type CanvasReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type CanvasGenerationConfig = {
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    reasoningEffort: CanvasReasoningEffort;
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export const defaultCanvasGenerationConfig: CanvasGenerationConfig = {
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    reasoningEffort: "auto",
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export function resolveCanvasModelForCapability(config: CanvasGenerationConfig, value: string | undefined, capability: CanvasNodeGenerationMode) {
    if (value?.trim()) return value;
    if (capability === "image") return config.imageModel || config.model;
    if (capability === "video") return config.videoModel || config.model;
    if (capability === "text") return config.textModel || config.model;
    return config.audioModel || config.model;
}
