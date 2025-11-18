import { Component, For, Show, createMemo } from "solid-js";
import { useDraftStrategy, DraftStrategy } from "../../contexts/DraftStrategyContext";
import { Team } from "@draftgap/core/src/models/Team";
import { buttonVariants } from "../common/Button";
import { cn } from "../../utils/style";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { classifyComposition } from "../../utils/compositionClassifier";

const STRATEGY_DETAILS: Record<DraftStrategy, { label: string; description: string }> = {
    balanced: {
        label: "Balanced",
        description: "Flexibilité, focus sur une draft polyvalente.",
    },
    teamfight: {
        label: "Teamfight",
        description: "Renforce les duos clés pour les objectifs groupés.",
    },
    split: {
        label: "Split push",
        description: "Priorise les side lanes et le scaling individuel.",
    },
    protect: {
        label: "Protect",
        description: "Protège un carry principal et renforce le late game.",
    },
    poke: {
        label: "Poke",
        description: "Cherche à user l'adversaire avant l'engagement.",
    },
    catch: {
        label: "Catch",
        description: "Accent sur les picks rapides et le contrôle de vision.",
    },
};

const TEAM_LABELS: Record<Team, string> = {
    ally: "Allies",
    opponent: "Opposants",
};

export const DraftStrategyPanel: Component = () => {
    const { strategies, setStrategy, options } = useDraftStrategy();
    const {
        allyDraftAnalysis,
        opponentDraftAnalysis,
        allyTeamData,
        opponentTeamData,
        allyTeamComp,
        opponentTeamComp,
    } = useDraftAnalysis();

    const compositionSummary = createMemo(() => ({
        ally: classifyComposition({
            draftResult: allyDraftAnalysis(),
            teamData: allyTeamData(),
            teamComp: allyTeamComp(),
        }),
        opponent: classifyComposition({
            draftResult: opponentDraftAnalysis(),
            teamData: opponentTeamData(),
            teamComp: opponentTeamComp(),
        }),
    }));

    return (
        <div class="bg-neutral-900/70 border border-neutral-800/60 rounded-xl p-4 flex flex-col gap-4">
            <div>
                <h3 class="text-xs uppercase text-neutral-400 tracking-wide">
                    Plan de draft
                </h3>
                <p class="text-[11px] text-neutral-500">
                    Choisis l'orientation souhaitée pour guider les recommandations.
                </p>
            </div>
            <div class="grid md:grid-cols-2 gap-4">
                <For each={["ally", "opponent"] as Team[]}>
                    {(team) => (
                        <div class="bg-neutral-950/70 border border-neutral-800/60 rounded-lg p-3 flex flex-col gap-3">
                            <div class="flex items-center justify-between">
                                <span class="text-xs uppercase text-neutral-400">
                                    {TEAM_LABELS[team]}
                                </span>
                                <Show when={compositionSummary()[team]}>
                                    {(summary) => (
                                        <span class="text-[11px] uppercase text-primary-200">
                                            {summary().label}
                                        </span>
                                    )}
                                </Show>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <For each={options}>
                                    {(strategy) => (
                                        <button
                                            type="button"
                                            class={cn(
                                                buttonVariants({ variant: "transparent" }),
                                                "px-2 py-1 text-[11px] uppercase border",
                                                strategies()[team] === strategy
                                                    ? "bg-primary-500/20 border-primary-500/70 text-primary-100"
                                                    : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                                            )}
                                            onClick={() => setStrategy(team, strategy)}
                                        >
                                            {STRATEGY_DETAILS[strategy].label}
                                        </button>
                                    )}
                                </For>
                            </div>
                            <p class="text-[11px] text-neutral-500 leading-snug">
                                {STRATEGY_DETAILS[strategies()[team]].description}
                            </p>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
};

export default DraftStrategyPanel;

