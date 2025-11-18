import { Component, For, Show, createMemo } from "solid-js";
import { useDraft } from "../../contexts/DraftContext";
import { useDataset } from "../../contexts/DatasetContext";
import { useUser } from "../../contexts/UserContext";
import { championName } from "../../utils/i18n";
import { ChampionIcon } from "../icons/ChampionIcon";
import { cn } from "../../utils/style";

type SideKey = "blue" | "red";

type BanSuggestion = {
    championKey: string;
    label: string;
    priority: "S" | "A" | "B";
    tags: string[];
};

const BAN_RECOMMENDATIONS: Record<SideKey, BanSuggestion[]> = {
    blue: [
        {
            championKey: "266",
            label: "Aatrox",
            priority: "S",
            tags: ["Meta", "Top"],
        },
        {
            championKey: "113",
            label: "Sejuani",
            priority: "S",
            tags: ["Engage", "JG"],
        },
        {
            championKey: "429",
            label: "Kalista",
            priority: "A",
            tags: ["Bot", "Cheese"],
        },
        {
            championKey: "526",
            label: "Rell",
            priority: "A",
            tags: ["Support", "Flex"],
        },
        {
            championKey: "57",
            label: "Maokai",
            priority: "B",
            tags: ["JG", "Objective"],
        },
    ],
    red: [
        {
            championKey: "145",
            label: "Kai'Sa",
            priority: "S",
            tags: ["Bot", "Meta"],
        },
        {
            championKey: "875",
            label: "Sett",
            priority: "S",
            tags: ["Top", "Counter"],
        },
        {
            championKey: "777",
            label: "Yone",
            priority: "A",
            tags: ["Flex", "Mid"],
        },
        {
            championKey: "64",
            label: "Lee Sin",
            priority: "A",
            tags: ["JG", "Early"],
        },
        {
            championKey: "517",
            label: "Sylas",
            priority: "B",
            tags: ["Mid", "Teamfight"],
        },
    ],
};

const SIDE_METADATA: Record<SideKey, { label: string; accent: string; badge: string }> = {
    blue: {
        label: "Equipe bleue",
        accent: "border-sky-400/60 bg-sky-500/10 text-sky-200",
        badge: "text-sky-300",
    },
    red: {
        label: "Equipe rouge",
        accent: "border-rose-400/60 bg-rose-500/10 text-rose-200",
        badge: "text-rose-300",
    },
};

const priorityBadge = (priority: "S" | "A" | "B") => {
    if (priority === "S") return "Priorité S-tier";
    if (priority === "A") return "Haute priorité";
    return "Option";
};

const priorityClass = (priority: "S" | "A" | "B") => {
    switch (priority) {
        case "S":
            return "border-emerald-400/70 bg-emerald-500/15 text-emerald-200";
        case "A":
            return "border-amber-400/70 bg-amber-500/15 text-amber-200";
        default:
            return "border-neutral-700 bg-neutral-800/70 text-neutral-300";
    }
};

const computeIconSize = (count: number) => {
    if (count <= 10) return 36;
    if (count <= 20) return 30;
    if (count <= 30) return 24;
    if (count <= 40) return 20;
    return 16;
};

const baseScore: Record<"S" | "A" | "B", number> = {
    S: 95,
    A: 85,
    B: 72,
};

const computeScore = (suggestion: BanSuggestion, index: number) =>
    Math.max(40, baseScore[suggestion.priority] - index * 3);

const BanRecommendationPanel: Component = () => {
    const { bans, toggleBan, selection } = useDraft();
    const { dataset } = useDataset();
    const { config } = useUser();

    const selectedBans = createMemo(() =>
        bans.map((key) => ({
            key,
            label:
                dataset()?.championData[key]
                    ? championName(dataset()!.championData[key], config)
                    : key,
        }))
    );

    const iconSize = createMemo(() => computeIconSize(bans.length));
    const maxReached = createMemo(() => bans.length >= 50);

    const bestSuggestionFor = (side: SideKey) => {
        const pool = BAN_RECOMMENDATIONS[side];
        if (!pool || pool.length === 0) return undefined;
        const available = pool.find((suggestion) => !bans.includes(suggestion.championKey));
        return available ?? pool[0];
    };

    const blueSuggestion = createMemo(() => bestSuggestionFor("blue"));
    const redSuggestion = createMemo(() => bestSuggestionFor("red"));

    const activeSide = createMemo<SideKey | undefined>(() => {
        if (selection.team === "ally") return "blue";
        if (selection.team === "opponent") return "red";
        return undefined;
    });

    const labelFor = (suggestion: BanSuggestion | undefined) => {
        if (!suggestion) return undefined;
        const data = dataset()?.championData[suggestion.championKey];
        return data ? championName(data, config) : suggestion.label;
    };

    const renderSuggestion = (
        side: SideKey,
        suggestion: BanSuggestion | undefined
    ) => {
        const meta = SIDE_METADATA[side];
        const championLabel = labelFor(suggestion);
        const isHighlighted = activeSide() === side;
        const isAlreadyBanned = suggestion
            ? bans.includes(suggestion.championKey)
            : false;
        const disableSelect = maxReached() && !isAlreadyBanned;
        const highlightClass =
            side === "blue"
                ? "border-sky-400/70"
                : "border-rose-400/70";
        const chooseClass =
            side === "blue"
                ? "border-sky-400/60 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
                : "border-rose-400/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25";
        const pool = BAN_RECOMMENDATIONS[side];
        const suggestionIndex = suggestion
            ? pool.findIndex((entry) => entry.championKey === suggestion.championKey)
            : -1;
        const score =
            suggestion && suggestionIndex !== -1
                ? computeScore(suggestion, suggestionIndex)
                : suggestion
                  ? computeScore(suggestion, 0)
                  : undefined;

        return (
            <div class="space-y-3">
                <div class="flex items-center justify-between text-xs uppercase text-neutral-500">
                    <span class={meta.badge}>{meta.label}</span>
                    <Show when={isHighlighted}>
                        <span
                            class={cn(
                                "rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide",
                                meta.accent
                            )}
                        >
                            Votre tour
                        </span>
                    </Show>
                </div>
                <Show
                    when={suggestion}
                    fallback={
                        <div class="rounded-2xl border border-dashed border-neutral-700 px-4 py-6 text-center text-sm text-neutral-500">
                            Aucun ban prioritaire disponible.
                        </div>
                    }
                >
                    {(current) => (
                        <div
                            class={cn(
                                "rounded-2xl border border-neutral-800/70 bg-neutral-900/70 px-4 py-3 transition",
                                isHighlighted && highlightClass
                            )}
                        >
                            <div class="flex items-center gap-3">
                                <ChampionIcon
                                    championKey={current().championKey}
                                    size={44}
                                    class="overflow-hidden"
                                    imgClass={isAlreadyBanned ? "grayscale" : ""}
                                />
                                <div class="flex flex-1 items-center justify-between gap-2">
                                    <div class="flex flex-col">
                                        <div>
                                            <div class="text-sm font-semibold text-neutral-100">
                                                {championLabel}
                                            </div>
                                            <div class="text-[11px] uppercase text-neutral-500">
                                                {current().label}
                                            </div>
                                        </div>
                                        <div class="mt-1 flex items-center gap-3 text-[10px] uppercase text-neutral-500">
                                            <span
                                                class={cn(
                                                    "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] tracking-wide",
                                                    priorityClass(current().priority)
                                                )}
                                            >
                                                {priorityBadge(current().priority)}
                                            </span>
                                            <Show when={score !== undefined}>
                                                <span class="font-semibold text-neutral-200">
                                                    Score ban {score}
                                                </span>
                                            </Show>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <div class="flex flex-wrap gap-1 text-[10px] uppercase text-neutral-500">
                                            <For each={current().tags}>
                                                {(tag) => (
                                                    <span class="rounded-full border border-neutral-700 px-2 py-[2px]">
                                                        {tag}
                                                    </span>
                                                )}
                                            </For>
                                        </div>
                                        <button
                                            type="button"
                                            class={cn(
                                                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
                                                isAlreadyBanned
                                                    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                                                    : disableSelect
                                                    ? "border-neutral-800 bg-neutral-900/60 text-neutral-600"
                                                    : chooseClass
                                            )}
                                            disabled={disableSelect && !isAlreadyBanned}
                                            onClick={() => toggleBan(current().championKey)}
                                        >
                                            {isAlreadyBanned ? "Retirer" : "Choisir"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </Show>
            </div>
        );
    };

    return (
        <aside class="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-800/60 bg-neutral-900/60">
            <header class="border-b border-neutral-800/60 px-4 py-3">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-xs uppercase tracking-wide text-neutral-500">
                            Moteur de bans
                        </p>
                        <h3 class="text-sm font-semibold text-neutral-100">
                            Suggestions critiques & liste globale
                        </h3>
                    </div>
                    <span class="text-[11px] uppercase text-neutral-500">
                        {selectedBans().length} / 50
                    </span>
                </div>
            </header>

            <div class="border-b border-neutral-800/60 px-4 py-3">
                <Show
                    when={selectedBans().length}
                    fallback={
                        <div class="text-xs uppercase text-neutral-500">
                            Aucun ban enregistré. Utilisez un des boutons "Choisir" pour l'ajouter.
                        </div>
                    }
                >
                    <div class="flex flex-wrap items-center gap-2">
                        <For each={selectedBans()}>
                            {(ban) => (
                                <button
                                    type="button"
                                    class="relative"
                                    title={`Retirer ${ban.label}`}
                                    onClick={() => toggleBan(ban.key)}
                                >
                                    <ChampionIcon
                                        championKey={ban.key}
                                        size={iconSize()}
                                        class="overflow-hidden"
                                        imgClass="grayscale"
                                    />
                                    <span class="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[90%] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-neutral-100/80" />
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
                <Show when={maxReached()}>
                    <div class="mt-2 text-[10px] uppercase text-amber-300">
                        Limite de 50 bans atteinte : retirez-en un pour libérer de la place.
                    </div>
                </Show>
            </div>

            <div class="flex-1 px-4 py-4">
                <div class="flex h-full flex-col gap-5">
                    {renderSuggestion("blue", blueSuggestion())}
                    {renderSuggestion("red", redSuggestion())}
                </div>
            </div>
        </aside>
    );
};

export default BanRecommendationPanel;
