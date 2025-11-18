import { For } from "solid-js";
import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";
import { CountUp } from "../CountUp";
import { DamageDistributionBar } from "./DamageDistributionBar";
import { Pick } from "./Pick";
import { TeamOptions } from "./TeamOptions";
import { tooltip } from "../../directives/tooltip";
import { capitalize } from "../../utils/strings";
import { getRatingClass } from "../../utils/rating";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
tooltip;

interface IProps {
    team: "ally" | "opponent";
}

export function TeamSidebar(props: IProps) {
    const {
        allyDraftAnalysis: allyDraftResult,
        opponentDraftAnalysis: opponentDraftResult,
    } = useDraftAnalysis();

    const rating = () =>
        props.team === "ally"
            ? allyDraftResult()?.totalRating
            : opponentDraftResult()?.totalRating;

    const estimatedWinrate = () => ratingToWinrate(rating() ?? 0);

    return (
        <div class="bg-primary flex flex-col h-full relative">
            <DamageDistributionBar team={props.team} />
            <div class="flex-1 flex justify-center items-center bg-[#141414]">
                <div
                    class="flex flex-col items-center gap-2 text-center"
                    // @ts-ignore
                    use:tooltip={{
                        content: <>{capitalize(props.team)} estimation</>,
                    }}
                >
                    <span class="text-xs uppercase text-neutral-400 tracking-wide">
                        {props.team.toUpperCase()}
                    </span>
                    <div class="flex flex-col items-center gap-1">
                        <CountUp
                            value={estimatedWinrate()}
                            formatFn={(value) => (value * 100).toFixed(2)}
                            class={`${getRatingClass(
                                rating() ?? 0
                            )} transition-colors duration-500 text-2xl`}
                            style={{
                                "font-variant-numeric": "tabular-nums",
                            }}
                        />
                        <span class="text-[11px] uppercase text-neutral-500">
                            Winrate estime
                        </span>
                    </div>
                </div>
            </div>
            <For each={[0, 1, 2, 3, 4]}>
                {(index) => <Pick team={props.team} index={index} />}
            </For>
            <TeamOptions team={props.team} />
        </div>
    );
}


