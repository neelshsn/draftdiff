import { For, createEffect, createMemo } from "solid-js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../common/Dialog";
import { useUser } from "../../contexts/UserContext";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function FilterDialog(props: Props) {
    const { config, setConfig } = useUser();

    const normalizedPickRate = createMemo(() => {
        const value = Math.round(config.quickPickMinPickRate ?? 0);
        return Math.min(5, Math.max(0, Number.isFinite(value) ? value : 0));
    });

    createEffect(() => {
        const normalized = normalizedPickRate();
        if (normalized !== config.quickPickMinPickRate) {
            setConfig({ quickPickMinPickRate: normalized });
        }
    });

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent class="max-w-md space-y-4">
                <DialogHeader>
                    <DialogTitle class="text-2xl uppercase">
                        Filtres
                    </DialogTitle>
                </DialogHeader>
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-lg uppercase">
                            Pickrate minimum
                        </span>
                        <span class="text-sm text-neutral-300">
                            {normalizedPickRate()}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="5"
                        step="1"
                        value={normalizedPickRate()}
                        onInput={(event) => {
                            const value = Number(event.currentTarget.value);
                            if (Number.isNaN(value)) return;
                            setConfig({ quickPickMinPickRate: value });
                        }}
                        class="w-full cursor-pointer"
                        style={{ "accent-color": "#34d399" }}
                    />
                    <div class="flex justify-between text-[10px] uppercase text-neutral-500">
                        <For each={[0, 1, 2, 3, 4, 5]}>
                            {(value) => <span>{value}%</span>}
                        </For>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
