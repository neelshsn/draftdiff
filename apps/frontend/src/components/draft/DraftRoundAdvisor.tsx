import {
    Component,
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
} from "solid-js";
import { useDraft } from "../../contexts/DraftContext";
import {
    useDraftSuggestions,
    type StrategySuggestion,
} from "../../contexts/DraftSuggestionsContext";
import { Team } from "@draftgap/core/src/models/Team";
import { displayNameByRole, Role } from "@draftgap/core/src/models/Role";
import { buttonVariants } from "../common/Button";
import { cn } from "../../utils/style";
import ChampionCell from "../common/ChampionCell";
import { RoleIcon } from "../icons/roles/RoleIcon";
import {
    summarizeHighlight,
    type HighlightSummary,
} from "../../utils/highlights";
import { useDataset } from "../../contexts/DatasetContext";
import { useUser } from "../../contexts/UserContext";
import { championName } from "../../utils/i18n";
import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";
import { formatPercentage } from "../../utils/rating";
type AdvisorSuggestion = StrategySuggestion;

type AdvisorOption = {
    label: string;
    suggestion: AdvisorSuggestion;
    details: string[];
    highlight?: HighlightSummary;
};

const TEAM_LABELS: Record<Team, string> = {
    ally: "Allies",
    opponent: "Opposants",
};

function describePatternOption(
    suggestion: AdvisorSuggestion,
    championLabel: (key: string) => string
): Omit<AdvisorOption, "label" | "suggestion"> {
    const details: string[] = [];
    let highlight: HighlightSummary | undefined;
    const ref =
        suggestion.proSynergyRefs.find((entry) => entry.highlights.length > 0) ??
        suggestion.proSynergyRefs[0];
    if (ref) {
        details.push(
            `Avec ${displayNameByRole[ref.partnerRole]} - ${championLabel(
                ref.partnerChampionKey
            )}`
        );
        details.push(
            `${Math.round(ref.winrate * 100)}% sur ${Math.round(ref.games)} parties`
        );
        if (ref.highlights.length) {
            highlight = summarizeHighlight(ref.highlights[0]);
        }
    }
    if (Math.abs(suggestion.patternScore) > 1) {
        details.push(`Pattern score ${Math.round(suggestion.patternScore)}`);
    }
    if (!details.length) {
        details.push("Renforce les patterns observes en pro play.");
    }
    return {
        details,
        highlight,
    };
}

function describeCounterOption(
    suggestion: AdvisorSuggestion,
    championLabel: (key: string) => string
): Omit<AdvisorOption, "label" | "suggestion"> {
    const details: string[] = [];
    let highlight: HighlightSummary | undefined;
    const ref =
        suggestion.proMatchupRefs.find((entry) => entry.highlights.length > 0) ??
        suggestion.proMatchupRefs[0];
    if (ref) {
        details.push(
            `Vs ${displayNameByRole[ref.opponentRole]} - ${championLabel(
                ref.opponentChampionKey
            )}`
        );
        details.push(
            `${Math.round(ref.winrate * 100)}% sur ${Math.round(ref.games)} parties`
        );
        if (ref.highlights.length) {
            highlight = summarizeHighlight(ref.highlights[0]);
        }
    }
    const counterImpact = ratingToWinrate(suggestion.scores.counter) - 0.5;
    details.push(`Impact estime ${formatPercentage(counterImpact)}`);
    if (suggestion.banRecommendations?.length) {
        const bans = suggestion.banRecommendations
            .slice(0, 2)
            .map(
                (ban) =>
                    `${championLabel(ban.opponentChampionKey)} (${displayNameByRole[ban.opponentRole]})`
            )
            .join(", ");
        details.push(`Ban threats: ${bans}`);
    }
    return {
        details,
        highlight,
    };
}

function describeComfortOption(
    suggestion: AdvisorSuggestion
): Omit<AdvisorOption, "label" | "suggestion"> {
    const details: string[] = [
        `${Math.round(suggestion.sampleSize).toLocaleString()} parties`,
        `Fiabilite ${Math.round(suggestion.reliability * 100)}%`,
        `Pick rate ${(suggestion.pickRate * 100).toFixed(1)}%`,
    ];
    return {
        details,
        highlight: undefined,
    };
}

export const DraftRoundAdvisor: Component = () => {
    const { selection, allyTeam, opponentTeam, pickChampion, select } =
        useDraft();
    const { allySuggestions, opponentSuggestions } = useDraftSuggestions();
    const { dataset } = useDataset();
    const { config } = useUser();

    const championLabel = (key: string) => {
        const data = dataset()?.championData[key];
        return data ? championName(data, config) : key;
    };

    const totalPicks = createMemo(() => {
        const allyCount = allyTeam.reduce(
            (count, pick) => count + (pick.championKey ? 1 : 0),
            0
        );
        const opponentCount = opponentTeam.reduce(
            (count, pick) => count + (pick.championKey ? 1 : 0),
            0
        );
        return allyCount + opponentCount;
    });

    const draftRound = createMemo(() => Math.min(totalPicks() + 1, 10));

    const [activeTeam, setActiveTeam] = createSignal<Team>(
        selection.team ?? "ally"
    );

    createEffect(() => {
        if (selection.team) {
            setActiveTeam(selection.team);
        }
    });

    const findIndexForRole = (team: Team, role: Role) => {
        const picks = team === "ally" ? allyTeam : opponentTeam;
        const sameRoleEmpty = picks.findIndex(
            (pick) => pick.role === role && pick.championKey === undefined
        );
        if (sameRoleEmpty !== -1) return sameRoleEmpty;

        const emptySlot = picks.findIndex((pick) => pick.championKey === undefined);
        if (emptySlot !== -1) return emptySlot;

        const sameRoleSlot = picks.findIndex((pick) => pick.role === role);
        if (sameRoleSlot !== -1) return sameRoleSlot;

        return 0;
    };

    const computeOptions = (
        team: Team,
        source: AdvisorSuggestion[]
    ): AdvisorOption[] => {
        if (!source.length) return [];

        const roster = team === "ally" ? allyTeam : opponentTeam;
        const alreadyUsed = new Set(
            roster
                .map((pick) => pick.championKey)
                .filter((key): key is string => key !== undefined)
        );
        const uniqueChampions = new Set<string>();
        const options: AdvisorOption[] = [];

        const addOption = (
            label: string,
            candidates: AdvisorSuggestion[],
            describe: (
                suggestion: AdvisorSuggestion
            ) => Omit<AdvisorOption, "label" | "suggestion">
        ) => {
            for (const candidate of candidates) {
                if (uniqueChampions.has(candidate.championKey)) continue;
                if (alreadyUsed.has(candidate.championKey)) continue;
                if (candidate.gated) continue;

                const { details, highlight } = describe(candidate);
                options.push({
                    label,
                    suggestion: candidate,
                    details: details.length ? details : ["Suggestion disponible"],
                    highlight,
                });
                uniqueChampions.add(candidate.championKey);
                break;
            }
        };

        addOption(
            "Pattern pro",
            [...source].sort((a, b) => b.patternScore - a.patternScore),
            (candidate) => describePatternOption(candidate, championLabel)
        );

        addOption(
            "Counter direct",
            [...source].sort((a, b) => b.scores.counter - a.scores.counter),
            (candidate) => describeCounterOption(candidate, championLabel)
        );

        addOption(
            "Pick stable",
            [...source].sort((a, b) => b.volumeScore - a.volumeScore),
            describeComfortOption
        );

        return options;
    };

    const teamOptions = createMemo(() => ({
        ally: computeOptions(
            "ally",
            allySuggestions() as AdvisorSuggestion[]
        ),
        opponent: computeOptions(
            "opponent",
            opponentSuggestions() as AdvisorSuggestion[]
        ),
    }));

    const optionsForActiveTeam = createMemo(
        () => teamOptions()[activeTeam()]
    );

    const handleFocus = (team: Team, option: AdvisorOption) => {
        const index = findIndexForRole(team, option.suggestion.role);
        select(team, index);
        setActiveTeam(team);
    };

    const handleLock = (team: Team, option: AdvisorOption) => {
        const index = findIndexForRole(team, option.suggestion.role);
        pickChampion(team, index, option.suggestion.championKey, option.suggestion.role, {
            resetFilters: false,
        });
        setActiveTeam(team);
    };

    return (
        <div class="bg-neutral-900/70 border border-neutral-800/60 rounded-xl p-4 flex flex-col gap-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-col">
                    <span class="text-xs uppercase text-neutral-400 tracking-wide">
                        Round {draftRound()}
                    </span>
                    <span class="text-sm text-neutral-200">
                        Choisis ton angle de draft
                    </span>
                </div>
                <div class="flex gap-2">
                    <For each={["ally", "opponent"] as const}>
                        {(team) => (
                            <button
                                type="button"
                                class={cn(
                                    buttonVariants({ variant: "transparent" }),
                                    "px-3 py-1 text-xs uppercase border",
                                    activeTeam() === team
                                        ? "bg-primary-500/20 border-primary-500/70 text-primary-100"
                                        : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                                )}
                                onClick={() => setActiveTeam(team)}
                            >
                                {TEAM_LABELS[team]}
                            </button>
                        )}
                    </For>
                </div>
            </div>
            <Show
                when={optionsForActiveTeam().length > 0}
                fallback={
                    <span class="text-xs text-neutral-500">
                        Pas assez de donnees pour proposer un angle de draft pour ce round.
                    </span>
                }
            >
                <div class="grid gap-3 md:grid-cols-3">
                    <For each={optionsForActiveTeam()}>
                        {(option) => {
                            const team = activeTeam();
                            const isLockedOnTeam =
                                (team === "ally" ? allyTeam : opponentTeam).some(
                                    (pick) => pick.championKey === option.suggestion.championKey
                                );

                            return (
                                <div class="rounded-lg border border-neutral-800/60 bg-neutral-950/60 p-3 flex flex-col gap-3">
                                    <span class="text-[11px] uppercase text-neutral-400 tracking-wide">
                                        {option.label}
                                    </span>
                                    <div class="flex items-center justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <RoleIcon role={option.suggestion.role} class="h-4 w-4 text-neutral-400" />
                                            <ChampionCell
                                                championKey={option.suggestion.championKey}
                                                nameMaxLength={14}
                                            />
                                        </div>
                                        <span class="text-[11px] uppercase text-neutral-400">
                                            {displayNameByRole[option.suggestion.role]}
                                        </span>
                                    </div>
                                    <div class="flex flex-col gap-1 text-[11px] text-neutral-400">
                                        <For each={option.details}>
                                            {(detail) => <span>{detail}</span>}
                                        </For>
                                        <Show when={option.highlight}>
                                            {(highlightAccessor) => {
                                                const summary = highlightAccessor();
                                                return (
                                                    <div class="flex flex-col gap-0.5 text-[10px] text-neutral-500">
                                                        <span class="uppercase text-neutral-400">
                                                            {summary.isWin ? "Win pro" : "Loss pro"}
                                                        </span>
                                                        <span>
                                                            {summary.resultLabel} · {summary.title}
                                                        </span>
                                                        {summary.subtitle && <span>{summary.subtitle}</span>}
                                                        {summary.players && <span>{summary.players}</span>}
                                                    </div>
                                                );
                                            }}
                                        </Show>
                                    </div>
                                    <div class="flex gap-2 justify-end">
                                        <button
                                            type="button"
                                            class={cn(
                                                buttonVariants({ variant: "transparent" }),
                                                "px-2 py-1 text-[10px] uppercase border border-neutral-700 hover:border-primary-500/60"
                                            )}
                                            onClick={() => handleFocus(team, option)}
                                        >
                                            Focus
                                        </button>
                                        <button
                                            type="button"
                                            class={cn(
                                                buttonVariants({ variant: "secondary" }),
                                                "px-2 py-1 text-[10px] uppercase"
                                            )}
                                            disabled={isLockedOnTeam}
                                            onClick={() => handleLock(team, option)}
                                        >
                                            Lock
                                        </button>
                                    </div>
                                </div>
                            );
                        }}
                    </For>
                </div>
            </Show>
        </div>
    );
};

export default DraftRoundAdvisor;
