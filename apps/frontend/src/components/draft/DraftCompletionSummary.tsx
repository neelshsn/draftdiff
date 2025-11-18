import {
    Component,
    For,
    Show,
    createMemo,
    type JSX,
} from "solid-js";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { useDraft } from "../../contexts/DraftContext";
import ChampionCell from "../common/ChampionCell";
import { displayNameByRole, Role } from "@draftgap/core/src/models/Role";
import { DraftEvaluationPick } from "@draftgap/core/src/draft/engine";
import { Team } from "@draftgap/core/src/models/Team";
import { cn } from "../../utils/style";
import {
    NEON_THEMES,
    NEUTRAL_COLORS,
    createNeonSurface,
    hexToRgba,
    type NeonTheme,
} from "../../utils/neonTheme";
import { useDraftNeonThemes } from "../../utils/useDraftTheme";

type PickRow = DraftEvaluationPick & {
    roleLabel: string;
};

type SummaryResult = {
    totalScore: number;
    synergyScore: number;
    counterScore: number;
    exposurePenalty: number;
    compositionScore: number;
    riskScore: number;
    notes: string[];
    picks: PickRow[];
};

const formatScore = (value: number) =>
    value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);

const DraftCompletionSummary: Component = () => {
    const { allyTeam } = useDraft();
    const { activeTheme, advantageTheme, advantageTeam } =
        useDraftNeonThemes();
    const { allyDraftEvaluation } = useDraftAnalysis();

    const summary = createMemo<SummaryResult | undefined>(() => {
        const evaluation = allyDraftEvaluation();
        if (!evaluation) return undefined;

        const picks: PickRow[] = evaluation.picks.map((pick) => ({
            ...pick,
            roleLabel: displayNameByRole[pick.role as Role] ?? "Role inconnu",
        }));

        return {
            totalScore: evaluation.totalScore,
            synergyScore: evaluation.synergyScore,
            counterScore: evaluation.counterScore,
            exposurePenalty: evaluation.exposurePenalty,
            compositionScore: evaluation.compositionScore,
            riskScore: evaluation.riskScore,
            notes: [...evaluation.notes, ...evaluation.compositionNotes],
            picks,
        };
    });

    const headerAccentStyle = createMemo<JSX.CSSProperties>(() => ({
        color: hexToRgba(NEUTRAL_COLORS.textStrong, 0.92),
        backgroundImage: `linear-gradient(90deg, ${activeTheme().primary}, ${advantageTheme().secondary})`,
        backgroundClip: "text" as unknown as string,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
    }));

    const containerSurface = createNeonSurface(activeTheme, {
        spotlight: 0.26,
        baseAlpha: 0.68,
        hoverLift: 6,
        noiseOpacity: 0.06,
    });

    const containerFrameStyle = createMemo<JSX.CSSProperties>(() => {
        const theme = activeTheme();
        return {
            border: `1px solid ${hexToRgba(theme.secondary, 0.32)}`,
            background: `linear-gradient(140deg, ${hexToRgba(
                theme.primary,
                0.14
            )} 0%, rgba(7,11,19,0.88) 55%, rgba(4,7,12,0.94) 100%)`,
            boxShadow: `0 24px 60px -32px ${theme.glow}`,
        };
    });

    return (
        <div
            class="relative rounded-2xl border transition-all duration-500"
            style={containerFrameStyle()}
        >
            <div
                class="space-y-4 rounded-[1.7rem] p-5 text-[color:#E5F2FF] transition-all"
                style={containerSurface.style()}
                onPointerEnter={containerSurface.onPointerEnter}
                onPointerMove={containerSurface.onPointerMove}
                onPointerLeave={containerSurface.onPointerLeave}
            >
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold tracking-wide text-[#E5F2FF]">
                        Resume de composition
                    </h2>
                    <Show when={summary()}>
                        {(value) => (
                            <span
                                class="text-sm font-semibold uppercase tracking-wide"
                                style={headerAccentStyle()}
                            >
                                Score total {formatScore(value().totalScore)}
                            </span>
                        )}
                    </Show>
                </div>

                <Show
                    when={summary()}
                    fallback={<EmptyState theme={activeTheme()} />}
                >
                    {(value) => (
                        <div class="space-y-6">
                            <TeamBreakdown
                                total={value().totalScore}
                                composition={value().compositionScore}
                                synergy={value().synergyScore}
                                counter={value().counterScore}
                                risk={value().riskScore}
                                exposure={value().exposurePenalty}
                                notes={value().notes}
                                theme={activeTheme()}
                                advantageTheme={advantageTheme()}
                                advantageTeam={advantageTeam()}
                            />

                            <div class="grid gap-3">
                                <For each={value().picks}>
                                    {(pick, index) => (
                                        <PickCard
                                            pick={pick}
                                            order={index()}
                                            isLocked={
                                                allyTeam[index()]?.championKey !==
                                                undefined
                                            }
                                            theme={activeTheme()}
                                            advantageTheme={advantageTheme()}
                                            advantageTeam={advantageTeam()}
                                        />
                                    )}
                                </For>
                            </div>
                        </div>
                    )}
                </Show>
            </div>
        </div>
    );
};

const TeamBreakdown: Component<{
    total: number;
    composition: number;
    synergy: number;
    counter: number;
    risk: number;
    exposure: number;
    notes: string[];
    theme: NeonTheme;
    advantageTheme: NeonTheme;
    advantageTeam: Team | undefined;
}> = (props) => {
    const surface = createNeonSurface(() => props.advantageTheme, {
        spotlight: 0.38,
        baseAlpha: 0.78,
    });
    const notesColor =
        props.advantageTeam === "opponent"
            ? hexToRgba(props.advantageTheme.secondary, 0.82)
            : hexToRgba(props.advantageTheme.primary, 0.82);

    return (
        <div
            class="relative overflow-hidden rounded-xl p-4 transition-all duration-300 cursor-pointer select-none"
            style={surface.style()}
            onPointerEnter={surface.onPointerEnter}
            onPointerMove={surface.onPointerMove}
            onPointerLeave={surface.onPointerLeave}
        >
            <div class="flex flex-wrap gap-4 text-sm text-[#E5F2FF]">
                <Stat
                    label="Score total"
                    value={props.total}
                    highlight
                    theme={props.advantageTheme}
                />
                <Stat
                    label="Composition"
                    value={props.composition}
                    theme={props.theme}
                />
                <Stat
                    label="Synergie"
                    value={props.synergy}
                    theme={props.theme}
                />
                <Stat
                    label="Matchups"
                    value={props.counter}
                    theme={props.theme}
                />
                <Stat
                    label="Risque"
                    value={-props.risk}
                    negative
                    theme={props.advantageTheme}
                />
                <Stat
                    label="Exposure"
                    value={-props.exposure}
                    negative
                    theme={props.advantageTheme}
                />
            </div>
            <Show when={props.notes.length}>
                <ul
                    class="mt-3 space-y-1 text-xs"
                    style={{ color: notesColor }}
                >
                    <For each={props.notes}>{(note) => <li>- {note}</li>}</For>
                </ul>
            </Show>
        </div>
    );
};

const Stat: Component<{
    label: string;
    value: number;
    highlight?: boolean;
    negative?: boolean;
    theme: NeonTheme;
}> = (props) => {
    const accent = props.negative ? props.theme.secondary : props.theme.primary;
    const containerStyle: JSX.CSSProperties = {
        background: props.highlight
            ? `linear-gradient(135deg, ${hexToRgba(accent, 0.28)} 0%, rgba(17,24,39,0.28) 65%)`
            : `linear-gradient(135deg, rgba(17,24,39,0.25) 0%, rgba(11,15,22,0.48) 100%)`,
        border: `1px solid ${hexToRgba(accent, props.highlight ? 0.42 : 0.18)}`,
        boxShadow: props.highlight
            ? `0 0 12px -6px ${props.theme.glow}`
            : `0 0 8px -7px ${props.theme.glow}`,
    };

    const valueColor =
        props.value >= 0
            ? hexToRgba(props.theme.primary, props.highlight ? 0.95 : 0.85)
            : hexToRgba("#FF6B9A", 0.88);

    return (
        <div
            class="flex min-w-[8rem] flex-col rounded-lg px-3 py-2 transition-all duration-300"
            style={containerStyle}
        >
            <span class="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#94A3B8]">
                {props.label}
            </span>
            <span
                class={cn("mt-1 text-base font-semibold")}
                style={{
                    color: valueColor,
                    textShadow: `0 0 12px ${hexToRgba(accent, 0.35)}`,
                }}
            >
                {formatScore(props.value)}
            </span>
        </div>
    );
};

const PickCard: Component<{
    pick: PickRow;
    order: number;
    isLocked: boolean;
    theme: NeonTheme;
    advantageTheme: NeonTheme;
    advantageTeam: Team | undefined;
}> = (props) => {
    const surface = createNeonSurface(() => props.theme, {
        spotlight: props.advantageTeam === "ally" ? 0.38 : 0.3,
        baseAlpha: props.advantageTeam === "ally" ? 0.76 : 0.7,
    });

    const metrics = createMemo(() => [
        { label: "Fiabilite", value: props.pick.reliability },
        { label: "Blind", value: props.pick.blind },
        { label: "Flex", value: props.pick.flex },
        { label: "Synergie", value: props.pick.synergy },
        { label: "Matchup", value: props.pick.counter },
        { label: "Exposure", value: -props.pick.exposure },
    ]);

    const badgeStyle = createMemo<JSX.CSSProperties>(() => ({
        border: `1px solid ${hexToRgba(
            props.theme.primary,
            props.isLocked ? 0.55 : 0.25
        )}`,
        color: props.isLocked
            ? hexToRgba(props.theme.primary, 0.9)
            : hexToRgba(NEUTRAL_COLORS.textMuted, 0.9),
        background: `linear-gradient(135deg, ${hexToRgba(
            props.theme.secondary,
            props.isLocked ? 0.28 : 0.12
        )} 0%, rgba(11,15,22,0.52) 100%)`,
        boxShadow: props.isLocked
            ? `0 0 14px -6px ${props.theme.glow}`
            : `0 0 10px -8px ${props.theme.glow}`,
    }));

    const contributionStyle = createMemo<JSX.CSSProperties>(() => {
        const gradientStart =
            props.advantageTeam === "ally"
                ? props.theme.primary
                : props.advantageTheme.secondary;
        const gradientEnd =
            props.advantageTeam === "ally"
                ? props.theme.secondary
                : props.advantageTheme.primary;

        return {
            color: hexToRgba(NEUTRAL_COLORS.textStrong, 0.92),
            backgroundImage: `linear-gradient(90deg, ${gradientStart}, ${gradientEnd})`,
            backgroundClip: "text" as unknown as string,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
        };
    });

    return (
        <div
            class="relative overflow-hidden rounded-xl p-4 text-[#E5F2FF] transition-transform duration-300 cursor-pointer"
            style={surface.style()}
            onPointerEnter={surface.onPointerEnter}
            onPointerMove={surface.onPointerMove}
            onPointerLeave={surface.onPointerLeave}
        >
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <ChampionCell
                        championKey={props.pick.championKey}
                        nameMaxLength={16}
                    />
                    <div class="flex flex-col">
                        <span class="text-xs uppercase tracking-[0.24em] text-[#94A3B8]">
                            {props.pick.roleLabel}
                        </span>
                        <span
                            class="text-sm font-semibold"
                            style={contributionStyle()}
                        >
                            Contribution {formatScore(props.pick.total)}
                        </span>
                    </div>
                </div>
                <span
                    class={cn(
                        "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]",
                        props.isLocked && "animate-pulse"
                    )}
                    style={badgeStyle()}
                >
                    Slot {props.order + 1}
                </span>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
                <For each={metrics()}>
                    {(metric) => {
                        const isPositive = metric.value >= 0;
                        const metricAccent = isPositive
                            ? props.theme.primary
                            : props.advantageTheme.secondary;
                        return (
                            <div
                                class="rounded-lg px-2 py-1 shadow-sm transition-all duration-200"
                                style={{
                                    background: `linear-gradient(135deg, ${hexToRgba(
                                        metricAccent,
                                        isPositive ? 0.24 : 0.3
                                    )} 0%, rgba(11,15,22,0.55) 100%)`,
                                    border: `1px solid ${hexToRgba(
                                        metricAccent,
                                        isPositive ? 0.32 : 0.4
                                    )}`,
                                    boxShadow: `0 0 10px -8px ${
                                        isPositive
                                            ? props.theme.glow
                                            : props.advantageTheme.glow
                                    }`,
                                }}
                            >
                                <span class="text-[10px] uppercase tracking-[0.18em] text-[#94A3B8]">
                                    {metric.label}
                                </span>
                                <span
                                    class="block text-sm font-semibold"
                                    style={{
                                        color: hexToRgba(
                                            metricAccent,
                                            isPositive ? 0.92 : 0.88
                                        ),
                                        textShadow: `0 0 10px ${hexToRgba(
                                            metricAccent,
                                            0.35
                                        )}`,
                                    }}
                                >
                                    {formatScore(metric.value)}
                                </span>
                            </div>
                        );
                    }}
                </For>
            </div>
        </div>
    );
};

const EmptyState: Component<{ theme: NeonTheme }> = (props) => (
    <div
        class="rounded-xl border border-dashed px-4 py-6 text-center text-sm transition-all duration-300"
        style={{
            borderColor: hexToRgba(props.theme.primary, 0.32),
            background: `linear-gradient(135deg, ${hexToRgba(
                props.theme.primary,
                0.15
            )} 0%, rgba(11,15,22,0.45) 100%)`,
            color: hexToRgba(NEUTRAL_COLORS.textMuted, 0.9),
            boxShadow: `0 0 18px -8px ${props.theme.glow}`,
        }}
    >
        Ajoutez des champions pour generer le resume de draft.
    </div>
);

export default DraftCompletionSummary;
