import { useEffect, useId, useState } from "react";
import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { listDeeixTextModels, type DeeixTextModel } from "@/services/api/canvas-text";
import { cn } from "@/lib/utils";

type CanvasDeeixTextModelPickerProps = {
    value?: string;
    onChange: (model: string) => void;
    className?: string;
};

export function CanvasDeeixTextModelPicker({ value, onChange, className }: CanvasDeeixTextModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<DeeixTextModel[]>([]);

    useEffect(() => {
        let active = true;
        void listDeeixTextModels()
            .then((items) => {
                if (active) setModels(items);
            })
            .catch(() => {
                if (active) setModels([]);
            });
        return () => {
            active = false;
        };
    }, []);

    const selected = models.some((model) => model.platformModelName === value) ? value : "__auto__";
    const selectedModel = models.find((model) => model.platformModelName === selected);
    return (
        <Select
            open={open}
            value={selected}
            onOpenChange={(nextOpen) => {
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={(model) => onChange(model === "__auto__" ? "" : model)}
        >
            <SelectTrigger
                className={cn("canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors", "min-w-[9rem] justify-start", className)}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={selectedModel?.description || selectedModel?.platformModelName || "DEEIX 自动选择"}
            >
                <Cpu className="size-4 shrink-0 opacity-70" />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{selectedModel?.platformModelName || "DEEIX 自动选择"}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <SelectItem value="__auto__">DEEIX 自动选择</SelectItem>
                {models.map((model) => (
                    <SelectItem key={model.platformModelName} value={model.platformModelName} textValue={model.platformModelName}>
                        <span className="flex min-w-0 items-center gap-2">
                            <Cpu className="size-4 shrink-0 opacity-70" />
                            <span className="truncate">{model.platformModelName}</span>
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
