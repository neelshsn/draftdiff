import { Icon } from "solid-heroicons";
import { magnifyingGlass, xMark } from "solid-heroicons/outline";
import { createMemo, onCleanup, onMount, Show } from "solid-js";
import { useDraftFilters } from "../../contexts/DraftFiltersContext";
import { useUser } from "../../contexts/UserContext";
import { useDataset } from "../../contexts/DatasetContext";
import { championName } from "../../utils/i18n";

export function Search() {
    const { search, setSearch } = useDraftFilters();
    const { dataset } = useDataset();
    const { config, setConfig } = useUser();

    const normalize = (value: string) =>
        value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

    const autocompleteEntries = createMemo(() => {
        const data = dataset();
        if (!data) return [];
        const entries: Array<{ display: string; tokens: string[] }> = [];
        for (const champion of Object.values(data.championData)) {
            const display = championName(champion, config);
            const tokens = Array.from(
                new Set(
                    [display, champion.id, champion.key]
                        .map((value) => normalize(String(value ?? "")))
                        .filter((token) => token.length > 0)
                )
            );
            entries.push({
                display,
                tokens,
            });
        }
        return entries.sort((a, b) => a.display.localeCompare(b.display));
    });

    // eslint-disable-next-line prefer-const -- solid js ref
    let inputEl: HTMLInputElement | undefined = undefined;

    function onInput(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const rawValue = input.value;

        if (rawValue === "DANGEROUSLY_ENABLE_BETA_FEATURES") {
            setConfig((config) => ({ ...config, enableBetaFeatures: true }));
            setSearch("");
            if (inputEl) {
                inputEl.value = "";
            }
            return;
        }
        if (rawValue === "DANGEROUSLY_DISABLE_BETA_FEATURES") {
            setConfig((config) => ({ ...config, enableBetaFeatures: false }));
            setSearch("");
            if (inputEl) {
                inputEl.value = "";
            }
            return;
        }

        let nextValue = rawValue;
        const normalized = normalize(rawValue);

        if (normalized.length > 0) {
            const match = autocompleteEntries().find((entry) =>
                entry.tokens.some((token) => token.startsWith(normalized))
            );
            if (
                match &&
                match.display.toLowerCase() !== rawValue.toLowerCase()
            ) {
                nextValue = match.display;
                requestAnimationFrame(() => {
                    if (!inputEl) return;
                    inputEl.value = match.display;
                    inputEl.setSelectionRange(
                        rawValue.length,
                        match.display.length
                    );
                });
            }
        }

        setSearch(nextValue);
    }

    onMount(() => {
        if (!inputEl) return;
        const el = inputEl as HTMLInputElement;

        const onControlF = (e: KeyboardEvent) => {
            if (e.ctrlKey && (e.key === "f" || e.key == "k")) {
                e.preventDefault();
                el.focus();
            }
        };
        window.addEventListener("keydown", onControlF);

        const onTabOrEnter = (e: KeyboardEvent) => {
            if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                const firstTableRow = document.querySelector("table tbody tr");
                if (firstTableRow) {
                    (firstTableRow as HTMLElement).focus();
                }
            }
        };

        el.addEventListener("keydown", onTabOrEnter);
        onCleanup(() => {
            el.removeEventListener("keydown", onTabOrEnter);
            window.removeEventListener("keydown", onControlF);
        });
    });

    return (
        <div class="flex rounded-md flex-1">
            <div class="relative flex flex-grow items-stretch">
                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Icon
                        path={magnifyingGlass}
                        class="h-5 w-5 text-gray-400"
                        aria-hidden="true"
                    />
                </div>
                <input
                    ref={inputEl}
                    id="draftTableSearch"
                    class="text-lg py-1 block w-full rounded-md rounded-l-md border-gray-301 pl-10 bg-neutral-800 placeholder:text-neutral-500 text-neutral-100"
                    placeholder="SEARCH"
                    value={search()}
                    onInput={onInput}
                />
                <Show when={search().length}>
                    <button
                        class="absolute inset-y-0 right-0 flex items-center pr-3"
                        onClick={() => setSearch("")}
                    >
                        <Icon
                            path={xMark}
                            class="h-5 w-5 text-gray-400"
                            aria-hidden="true"
                        />
                    </button>
                </Show>
            </div>
        </div>
    );
}
