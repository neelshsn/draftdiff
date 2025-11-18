import { For, Show, createMemo } from "solid-js";
import { useDraftSuggestions } from "../../contexts/DraftSuggestionsContext";
import { useDraft } from "../../contexts/DraftContext";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { displayNameByRole, ROLES, Role } from "@draftgap/core/src/models/Role";
import { RoleIcon } from "../icons/roles/RoleIcon";
import ChampionCell from "../common/ChampionCell";
import { formatPercentage } from "../../utils/rating";
import { capitalize } from "../../utils/strings";
import { Team } from "@draftgap/core/src/models/Team";
import { cn } from "../../utils/style";
import type { StrategySuggestion } from "../../contexts/DraftSuggestionsContext";
import { MIN_BLIND_PICK_RATE } from "../../constants/draft";

export function BanTargets() {
    const { selection, toggleBan, bans } = useDraft();
    const {
        allyTeamComp,
        opponentTeamComp,
        allyDraftAnalysis,
        opponentDraftAnalysis,
    } = useDraftAnalysis();
    const { allySuggestions, opponentSuggestions } = useDraftSuggestions();
    const pickrateClass = (value: number | undefined) => {
        if (value === undefined) return "text-neutral-400";
        if (value >= 0.12) return "text-emerald-300";
        if (value >= 0.06) return "text-amber-300";
        return "text-neutral-300";
    };

    const winrateClass = (value: number | undefined) => {
        if (value === undefined) return "text-neutral-400";
        const delta = value - 0.5;
        if (delta >= 0.04) return "text-emerald-300";
        if (delta >= 0.02) return "text-amber-300";
        if (delta <= -0.04) return "text-rose-400";
        if (delta <= -0.02) return "text-rose-300";
        return "text-neutral-300";
    };

    const targetTeam = createMemo<Team>(() =>
        selection.team === "opponent" ? "ally" : "opponent"
    );

    const targetDraftResult = createMemo(() =>
        targetTeam() === "opponent"
            ? opponentDraftAnalysis()
            : allyDraftAnalysis()
    );

    const targetComp = createMemo(() =>
        targetTeam() === "opponent" ? opponentTeamComp() : allyTeamComp()
    );

    const suggestions = createMemo(() =>
        targetTeam() === "opponent" ? opponentSuggestions() : allySuggestions()
    );

    const suggestionsByRole = createMemo(() => {
        const grouped = new Map<Role, StrategySuggestion[]>();
        for (const suggestion of suggestions()) {
            const list = grouped.get(suggestion.role);
            if (list) {
                list.push(suggestion);
            } else {
                grouped.set(suggestion.role, [suggestion]);
            }
        }
        return grouped;
    });

    const isStable = (option: StrategySuggestion) =>
        !option.gated &&
        (option.blindSafety >= 0.6 ||
            option.pickRate >= MIN_BLIND_PICK_RATE);

    const compareSuggestions = (a: StrategySuggestion, b: StrategySuggestion) => {
        const pickRateDiff = (b.pickRate ?? 0) - (a.pickRate ?? 0);
        if (pickRateDiff !== 0) {
            return pickRateDiff;
        }
        const ratingDiff =
            b.draftResult.totalRating - a.draftResult.totalRating;
        if (ratingDiff !== 0) {
            return ratingDiff;
        }
        return (b.sampleSize ?? 0) - (a.sampleSize ?? 0);
    };

    const rows = createMemo(() =>
        ROLES.map((role) => {
            const lockedChampionKey = targetComp().get(role);
            const options = [...(suggestionsByRole().get(role) ?? [])];
            options.sort(compareSuggestions);
            const targets = options.slice(0, 3).map((suggestion) => {
                const stable = isStable(suggestion);
                return {
                    suggestion,
                    requiresWarning: !stable || suggestion.gated,
                    stable,
                } as const;
            });

            return {
                role,
                lockedChampionKey,
                targets,
            };
        })
    );

    const priorityBanRole = createMemo<Role | undefined>(() => {
        let bestRole: Role | undefined;
        let bestTarget:
            | {
                  suggestion: StrategySuggestion;
                  requiresWarning: boolean;
              }
            | undefined;
        let bestRequiresWarning = true;

        for (const row of rows()) {
            const availableTarget = row.targets.find(
                (entry) =>
                    !bans.includes(entry.suggestion.championKey)
            );
            if (!availableTarget) {
                continue;
            }

            if (!bestTarget) {
                bestRole = row.role;
                bestTarget = availableTarget;
                bestRequiresWarning = availableTarget.requiresWarning;
                continue;
            }

            const diff = compareSuggestions(
                availableTarget.suggestion,
                bestTarget.suggestion
            );

            if (
                diff < 0 ||
                (diff === 0 &&
                    bestRequiresWarning &&
                    !availableTarget.requiresWarning)
            ) {
                bestRole = row.role;
                bestTarget = availableTarget;
                bestRequiresWarning = availableTarget.requiresWarning;
            }
        }

        return bestRole;
    });

    return (
        <div class="mb-4">
            <div class="bg-neutral-900 border border-neutral-700 rounded-lg p-4">
                <div class="flex justify-between items-center mb-3">
                    <span class="text-xs uppercase text-neutral-400 tracking-wide">
                        Ban targets vs {capitalize(targetTeam())} team
                    </span>
                </div>
                <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                    <For each={rows()}>
                        {(row) => {
                            const locked = row.lockedChampionKey !== undefined;
                            return (
                                <div class="bg-gradient-to-b from-neutral-950/85 via-neutral-900/65 to-slate-900/55 border border-neutral-800/40 rounded-xl px-3 py-3 flex flex-col gap-3 h-full">
                                    <div class="flex items-center gap-2 text-xs uppercase text-neutral-300 tracking-wide">
                                        <RoleIcon role={row.role} class="h-5 w-5" />
                                        {displayNameByRole[row.role]}
                                    </div>
                                    <Show when={locked}>
                                        <div class="flex flex-col gap-1 text-xs text-neutral-400">
                                            <ChampionCell
                                                championKey={row.lockedChampionKey!}
                                                nameMaxLength={12}
                                            />
                                            <span>Role verrouille</span>
                                        </div>
                                    </Show>
                                    <Show when={!locked}>
                                        <Show
                                            when={row.targets.length > 0}
                                            fallback={
                                                <span class="text-xs text-neutral-500 italic">
                                                    Aucun ban prioritaire disponible
                                                </span>
                                            }
                                        >
                                            <div class="flex flex-col gap-2">
                                                <For each={row.targets}>
                                                    {(entry, index) => {
                                                        const suggestion = entry.suggestion;
                                                        const banned = () =>
                                                            bans.includes(
                                                                suggestion.championKey
                                                            );
                                                        const priority = () =>
                                                            priorityBanRole() === row.role &&
                                                            index() === 0 &&
                                                            !banned();
                                                        return (
                                                            <button
                                                                type="button"
                                                                class={cn(
                                                                    "flex flex-col gap-2 rounded-lg border border-neutral-800/60 bg-neutral-950/70 px-2 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-rose-400/60",
                                                                    banned()
                                                                        ? "opacity-60 grayscale"
                                                                        : "hover:border-rose-400/60 hover:shadow-[0_0_16px_rgba(248,113,113,0.25)]",
                                                                    entry.requiresWarning &&
                                                                        !banned()
                                                                        ? "border-amber-500/50"
                                                                        : "",
                                                                    priority()
                                                                        ? "ring-2 ring-rose-400/80"
                                                                        : ""
                                                                )}
                                                                onClick={() =>
                                                                    toggleBan(
                                                                        suggestion.championKey
                                                                    )
                                                                }
                                                            >
                                                                <div class="flex items-center justify-between gap-3">
                                                                    <ChampionCell
                                                                        championKey={
                                                                            suggestion.championKey
                                                                        }
                                                                        nameMaxLength={12}
                                                                    />
                                                                    <div class="flex flex-col items-end text-[10px] uppercase gap-0.5">
                                                                        <span
                                                                            class={cn(
                                                                                "font-semibold",
                                                                                pickrateClass(
                                                                                    suggestion.pickRate
                                                                                )
                                                                            )}
                                                                        >
                                                                            Pickrate{" "}
                                                                            {formatPercentage(
                                                                                suggestion.pickRate ?? 0
                                                                            )}
                                                                            %
                                                                        </span>
                                                                        <span
                                                                            class={cn(
                                                                                "font-semibold",
                                                                                winrateClass(
                                                                                    suggestion.draftResult
                                                                                        .winrate
                                                                                )
                                                                            )}
                                                                        >
                                                                            Winrate{" "}
                                                                            {formatPercentage(
                                                                                suggestion.draftResult
                                                                                    .winrate
                                                                            )}
                                                                            %
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div class="flex items-center justify-between text-[10px] uppercase text-neutral-400">
                                                                    <Show
                                                                        when={!entry.requiresWarning}
                                                                        fallback={
                                                                            <span class="text-amber-300">
                                                                                {suggestion.gated
                                                                                    ? "Conditionnel"
                                                                                    : "Volatil"}
                                                                            </span>
                                                                        }
                                                                    >
                                                                        <span class="text-emerald-300">
                                                                            Blind safe
                                                                        </span>
                                                                    </Show>
                                                                    <span
                                                                        class={cn(
                                                                            banned()
                                                                                ? "text-red-400"
                                                                                : "text-neutral-400"
                                                                        )}
                                                                    >
                                                                        {banned() ? "Banni" : "Bannir"}
                                                                    </span>
                                                                </div>
                                                                <Show when={priority()}>
                                                                    <span class="text-[10px] uppercase text-red-300 tracking-wide">
                                                                        Priority ban
                                                                    </span>
                                                                </Show>
                                                            </button>
                                                        );
                                                    }}
                                                </For>
                                            </div>
                                        </Show>
                                    </Show>
                                </div>
                            );
                        }}
                    </For>
                </div>
            </div>
        </div>
    );
}
