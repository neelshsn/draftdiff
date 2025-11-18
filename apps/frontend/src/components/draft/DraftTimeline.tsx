import { Component, For, Show, createMemo } from "solid-js";
import { useDraft, DRAFT_SEQUENCE } from "../../contexts/DraftContext";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { useDataset } from "../../contexts/DatasetContext";
import { useUser } from "../../contexts/UserContext";
import { championName } from "../../utils/i18n";
import { Role, ROLES, displayNameByRole } from "@draftgap/core/src/models/Role";
import { RoleIcon } from "../icons/roles/RoleIcon";
import { ChampionIcon } from "../icons/ChampionIcon";
import { cn } from "../../utils/style";
import {
    NEON_THEMES,
    createNeonSurface,
    hexToRgba,
    type NeonTheme,
} from "../../utils/neonTheme";
import { useDraftNeonThemes } from "../../utils/useDraftTheme";
import { Team } from "@draftgap/core/src/models/Team";
import { DraftEvaluationPick } from "@draftgap/core/src/draft/engine";

type TimelineSlot = {
    team: "ally" | "opponent";
    index: number;
    order: number;
    championKey?: string;
    role?: Role;
    isActive: boolean;
    isLocked: boolean;
    roleProbabilities?: Map<Role, number>;
    score?: number;
};

const championSplash = (id?: string) =>
    id
        ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${
              id === "Fiddlesticks" ? "FiddleSticks" : id
          }_0.jpg`
        : undefined;

const SLOT_PREFIX: Record<"ally" | "opponent", string> = {
    ally: "B",
    opponent: "R",
};

const slotTheme = (team: Team): NeonTheme => NEON_THEMES[team];

type DraftSlotLabel =
    | "B1"
    | "R1"
    | "R2"
    | "B2"
    | "B3"
    | "R3"
    | "R4"
    | "B4"
    | "B5"
    | "R5";

type ContributionWeights = {
    k1: number;
    k3: number;
    k4: number;
    k5: number;
    k6: number;
    k7: number;
};

const DEFAULT_WEIGHTS: ContributionWeights = {
    k1: 0.4,
    k3: 0.1,
    k4: 0.25,
    k5: 0.2,
    k6: 0.05,
    k7: 0.1,
};

const SLOT_WEIGHTS: Record<DraftSlotLabel, ContributionWeights> = {
    B1: { k1: 0.6, k3: 0.2, k4: 0, k5: 0, k6: 0, k7: 0.2 },
    R1: { k1: 0.4, k3: 0.1, k4: 0.25, k5: 0.2, k6: 0, k7: 0.05 },
    R2: { k1: 0.4, k3: 0.1, k4: 0.25, k5: 0.2, k6: 0, k7: 0.05 },
    B2: { k1: 0.4, k3: 0, k4: 0.3, k5: 0.3, k6: 0, k7: 0 },
    B3: { k1: 0.4, k3: 0, k4: 0.3, k5: 0.3, k6: 0, k7: 0 },
    R3: { k1: 0.2, k3: 0, k4: 0.4, k5: 0.4, k6: 0, k7: 0 },
    R4: { k1: 0.2, k3: 0, k4: 0.4, k5: 0.4, k6: 0, k7: 0 },
    B4: { k1: 0.1, k3: 0, k4: 0.4, k5: 0.5, k6: 0, k7: 0 },
    B5: { k1: 0.1, k3: 0, k4: 0.4, k5: 0.5, k6: 0, k7: 0 },
    R5: { k1: 0.05, k3: 0, k4: 0.3, k5: 0.65, k6: 0, k7: 0 },
};

const resolveSlotLabel = (slot: { team: Team; index: number }): DraftSlotLabel | undefined => {
    if (slot.team === "ally") {
        switch (slot.index) {
            case 0:
                return "B1";
            case 1:
                return "B2";
            case 2:
                return "B3";
            case 3:
                return "B4";
            case 4:
                return "B5";
        }
    } else {
        switch (slot.index) {
            case 0:
                return "R1";
            case 1:
                return "R2";
            case 2:
                return "R3";
            case 3:
                return "R4";
            case 4:
                return "R5";
        }
    }
    return undefined;
};

const getSlotWeights = (slot: { team: Team; index: number }): ContributionWeights => {
    const label = resolveSlotLabel(slot);
    if (!label) return { ...DEFAULT_WEIGHTS };
    const weights = SLOT_WEIGHTS[label];
    if (!weights) return { ...DEFAULT_WEIGHTS };
    return {
        k1: weights.k1 ?? 0,
        k3: weights.k3 ?? 0,
        k4: weights.k4 ?? 0,
        k5: weights.k5 ?? 0,
        k6: weights.k6 ?? 0,
        k7: weights.k7 ?? 0,
    };
};

const calculatePickScore = (pick: DraftEvaluationPick, weights: ContributionWeights) =>
    weights.k1 * pick.reliability +
    weights.k3 * pick.flex +
    weights.k4 * pick.synergy +
    weights.k5 * pick.counter +
    weights.k6 * pick.deny -
    weights.k7 * pick.exposure;

const buildSlotWeightMap = (
    team: Team,
    picks: ReturnType<typeof useDraft>["allyTeam"] | ReturnType<typeof useDraft>["opponentTeam"]
) => {
    const map = new Map<string, ContributionWeights>();
    for (const slot of DRAFT_SEQUENCE) {
        if (slot.team !== team) continue;
        const entry =
            team === "ally"
                ? (picks as ReturnType<typeof useDraft>["allyTeam"])[slot.index]
                : (picks as ReturnType<typeof useDraft>["opponentTeam"])[slot.index];
        if (entry?.championKey) {
            map.set(entry.championKey, getSlotWeights(slot));
        }
    }
    return map;
};

export const DraftTimeline: Component = () => {
    const { allyTeam, opponentTeam, currentTurn, select, bans, assignRole } =
        useDraft();
    const {
        allyRoles,
        opponentRoles,
        allyDraftEvaluation,
        opponentDraftEvaluation,
    } = useDraftAnalysis();
    const { dataset } = useDataset();
    const { config } = useUser();
    const { activeTheme, advantageTheme, advantageTeam } = useDraftNeonThemes();

    const allySlotWeights = createMemo(() => buildSlotWeightMap("ally", allyTeam));
    const opponentSlotWeights = createMemo(() =>
        buildSlotWeightMap("opponent", opponentTeam)
    );

    const championInfo = (championKey: string | undefined) => {
        if (!championKey) return undefined;
        const data = dataset()?.championData[championKey];
        if (!data) return undefined;
        return {
            label: championName(data, config),
            id: data.id,
        };
    };

    const allyPickScores = createMemo(() => {
        const map = new Map<string, number>();
        const evaluation = allyDraftEvaluation();
        if (!evaluation) return map;
        const weightMap = allySlotWeights();
        for (const pick of evaluation.picks) {
            const weights = weightMap.get(pick.championKey) ?? DEFAULT_WEIGHTS;
            map.set(pick.championKey, calculatePickScore(pick, weights));
        }
        return map;
    });

    const opponentPickScores = createMemo(() => {
        const map = new Map<string, number>();
        const evaluation = opponentDraftEvaluation();
        if (!evaluation) return map;
        const weightMap = opponentSlotWeights();
        for (const pick of evaluation.picks) {
            const weights = weightMap.get(pick.championKey) ?? DEFAULT_WEIGHTS;
            map.set(pick.championKey, calculatePickScore(pick, weights));
        }
        return map;
    });

    const slots = createMemo<TimelineSlot[]>(() => {
        const active = currentTurn();
        const allyRoleMap = allyRoles();
        const opponentRoleMap = opponentRoles();
        const allyScores = allyPickScores();
        const opponentScores = opponentPickScores();
        return DRAFT_SEQUENCE.map((slot, order) => {
            const picks = slot.team === "ally" ? allyTeam : opponentTeam;
            const pick = picks[slot.index];
            const roleProbabilities =
                pick.championKey !== undefined
                    ? (slot.team === "ally"
                          ? allyRoleMap.get(pick.championKey)
                          : opponentRoleMap.get(pick.championKey))
                    : undefined;
            const scoreMap = slot.team === "ally" ? allyScores : opponentScores;
            const score =
                pick.championKey !== undefined
                    ? scoreMap.get(pick.championKey)
                    : undefined;
            return {
                team: slot.team,
                index: slot.index,
                order,
                championKey: pick.championKey,
                role: pick.role,
                isActive:
                    active?.team === slot.team && active?.index === slot.index,
                isLocked: Boolean(pick.championKey),
                roleProbabilities,
                score,
            };
        });
    });

    const blueSide = () => slots().filter((slot) => slot.team === "ally");
    const redSide = () => slots().filter((slot) => slot.team === "opponent");

    const frameStyle = createMemo(() => ({
        border: `1px solid ${hexToRgba(activeTheme().secondary, 0.28)}`,
        background: `linear-gradient(120deg, ${hexToRgba(
            NEON_THEMES.ally.primary,
            0.18
        )} 0%, rgba(8,12,18,0.9) 48%, ${hexToRgba(
            NEON_THEMES.opponent.secondary,
            0.18
        )} 100%)`,
        boxShadow: `0 24px 60px -32px ${advantageTheme().glow}`,
    }));

    const summaryTheme = createMemo(() =>
        advantageTeam() ? slotTheme(advantageTeam()!) : activeTheme()
    );

    const handleAssignRole = (slot: TimelineSlot, role: Role | undefined) => {
        if (!slot.championKey) return;
        assignRole(slot.team, slot.index, role);
    };

    return (
        <div
            class="rounded-3xl border px-5 py-5 transition-all duration-300"
            style={frameStyle()}
        >
            <div class="flex items-stretch gap-4">
                <TimelineSide
                    slots={blueSide()}
                    label="Equipe Bleue"
                    championInfo={championInfo}
                    onSelect={select}
                    onAssignRole={handleAssignRole}
                    bans={bans}
                    theme={slotTheme("ally")}
                    highlighted={advantageTeam() === "ally"}
                />
                <TimelineSummary
                    slots={slots()}
                    theme={summaryTheme()}
                    advantageTeam={advantageTeam()}
                />
                <TimelineSide
                    slots={redSide()}
                    label="Equipe Rouge"
                    championInfo={championInfo}
                    onSelect={select}
                    onAssignRole={handleAssignRole}
                    bans={bans}
                    theme={slotTheme("opponent")}
                    highlighted={advantageTeam() === "opponent"}
                    reverse
                />
            </div>
        </div>
    );
};

const TimelineSummary: Component<{
    slots: TimelineSlot[];
    theme: NeonTheme;
    advantageTeam: Team | undefined;
}> = (props) => {
    const locked = () => props.slots.filter((slot) => slot.isLocked).length;
    const total = () => props.slots.length;
    const active = () => props.slots.find((slot) => slot.isActive);
    const surface = createNeonSurface(() => props.theme, {
        spotlight: props.advantageTeam ? 0.4 : 0.32,
        baseAlpha: 0.78,
        hoverLift: 0,
    });

    return (
        <div
            class="hidden min-w-[260px] flex-col justify-between rounded-2xl border px-5 py-5 text-center text-xs uppercase tracking-[0.28em] text-[#8CA1C7] lg:flex"
            style={surface.style()}
            onPointerEnter={surface.onPointerEnter}
            onPointerMove={surface.onPointerMove}
            onPointerLeave={surface.onPointerLeave}
        >
            <div>
                <div
                    class="text-sm font-semibold"
                    style={{ color: hexToRgba(props.theme.primary, 0.95) }}
                >
                    Statut de la draft
                </div>
                <div
                    class="mt-1 text-lg font-bold"
                    style={{
                        color: hexToRgba(props.theme.secondary, 0.95),
                        textShadow: `0 0 18px ${props.theme.glow}`,
                    }}
                >
                    {locked()} / {total()}
                </div>
            </div>
            <div
                class="text-[11px] tracking-[0.24em]"
                style={{ color: hexToRgba(props.theme.primary, 0.75) }}
            >
                {active()
                    ? `Tour actuel : ${active()!.team === "ally" ? "Bleu" : "Rouge"}`
                    : "Draft terminee"}
            </div>
        </div>
    );
};

const TimelineSide: Component<{
    slots: TimelineSlot[];
    label: string;
    championInfo: (
        key: string | undefined
    ) => { label: string; id: string } | undefined;
    onSelect: (
        team: "ally" | "opponent",
        index: number,
        resetFilters: boolean
    ) => void;
    onAssignRole: (slot: TimelineSlot, role: Role | undefined) => void;
    bans: string[];
    theme: NeonTheme;
    highlighted: boolean;
    reverse?: boolean;
}> = (props) => {
    const surface = createNeonSurface(() => props.theme, {
        spotlight: props.highlighted ? 0.4 : 0.32,
        baseAlpha: props.highlighted ? 0.78 : 0.7,
    });

    return (
        <div
            class={cn(
                "relative flex min-w-[0] flex-1 flex-col gap-3 rounded-2xl border px-4 py-4 transition-all duration-300",
                props.reverse && "items-end text-right"
            )}
            style={surface.style()}
            onPointerEnter={surface.onPointerEnter}
            onPointerMove={surface.onPointerMove}
            onPointerLeave={surface.onPointerLeave}
        >
            <div class="flex w-full flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.3em] text-[#95A8CE]">
                <span
                    class="text-sm font-semibold"
                    style={{
                        color: hexToRgba(props.theme.primary, 0.9),
                        textShadow: `0 0 16px ${props.theme.glow}`,
                    }}
                >
                    {props.label}
                </span>
                <Show when={props.bans.length}>
                    <div class="flex flex-wrap items-center gap-1">
                        <For each={props.bans}>
                            {(championKey) => {
                                const info = () => props.championInfo(championKey);
                                return (
                                    <Show when={info()}>
                                        <div
                                            class="relative overflow-hidden rounded-full border"
                                            style={{
                                                borderColor: hexToRgba(
                                                    props.theme.secondary,
                                                    0.4
                                                ),
                                                boxShadow: `0 0 12px -8px ${props.theme.glow}`,
                                            }}
                                            title={`Ban ${info()!.label}`}
                                        >
                                            <ChampionIcon
                                                championKey={championKey}
                                                size={24}
                                                class="overflow-hidden"
                                                imgClass="grayscale opacity-75"
                                            />
                                            <span class="pointer-events-none absolute left-[3px] right-[3px] top-1/2 -translate-y-1/2 rotate-45 border-t border-white/60" />
                                        </div>
                                    </Show>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </div>
            <div
                class={cn(
                    "flex gap-3 overflow-x-auto pb-1",
                    props.reverse && "justify-end"
                )}
            >
                <For each={props.slots}>
                    {(slot) => (
                        <TimelineCard
                            slot={slot}
                            info={props.championInfo(slot.championKey)}
                            onClick={() => props.onSelect(slot.team, slot.index, false)}
                            onAssignRole={(role) => props.onAssignRole(slot, role)}
                            theme={props.theme}
                        />
                    )}
                </For>
            </div>
        </div>
    );
};

const TimelineCard: Component<{
    slot: TimelineSlot;
    info?: { label: string; id: string };
    onClick: () => void;
    theme: NeonTheme;
    onAssignRole?: (role: Role | undefined) => void;
}> = (props) => {
    const slotLabel = `${SLOT_PREFIX[props.slot.team]}${props.slot.index + 1}`;
    const splash = championSplash(props.info?.id);
    const cardSurface = createNeonSurface(() => props.theme, {
        spotlight: props.slot.isActive ? 0.42 : 0.3,
        baseAlpha: props.slot.isLocked ? 0.8 : 0.68,
    });
    const lockedGlowStyle = createMemo(() => ({
        background: `linear-gradient(135deg, ${hexToRgba(
            props.theme.primary,
            0.35
        )} 0%, rgba(6, 10, 16, 0.15) 55%, ${hexToRgba(
            props.theme.secondary,
            0.3
        )} 100%)`,
        boxShadow: `0 0 42px -14px ${props.theme.glow}`,
    }));
    const dustTintStyle = createMemo(() => ({
        boxShadow: `0 0 22px -16px ${props.theme.glow}`,
    }));

    const roleEntries = createMemo(() => {
        const map = props.slot.roleProbabilities;
        const entries: Array<[Role, number]> = map
            ? Array.from(map.entries())
            : [];
        if (
            props.slot.role !== undefined &&
            !entries.some(([r]) => r === props.slot.role)
        ) {
            entries.push([props.slot.role, 1]);
        }
        return entries
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
    });

    const handleRoleClick = (event: MouseEvent, role: Role) => {
        event.stopPropagation();
        if (!props.onAssignRole) return;
        if (props.slot.role === role) {
            props.onAssignRole(undefined);
        } else {
            props.onAssignRole(role);
        }
    };
    const scoreValue = createMemo(() => props.slot.score);

    return (
        <button
            type="button"
            class="relative flex h-[220px] w-[125px] min-w-[125px] flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300"
            style={cardSurface.style()}
            onPointerEnter={cardSurface.onPointerEnter}
            onPointerMove={cardSurface.onPointerMove}
            onPointerLeave={cardSurface.onPointerLeave}
            onClick={props.onClick}
        >
            <Show when={splash}>
                {(src) => (
                    <img
                        src={src()}
                        alt={props.info?.label ?? slotLabel}
                        class="absolute inset-0 h-full w-full object-cover object-top"
                    />
                )}
            </Show>

            <div class="absolute inset-0 bg-gradient-to-b from-black/75 via-black/25 to-black/80" />

            <Show when={props.slot.isLocked}>
                <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <div
                        class="neon-card-glow absolute inset-[-12%] rounded-[inherit]"
                        style={lockedGlowStyle()}
                    />
                    <div
                        class="neon-dust absolute inset-0"
                        style={dustTintStyle()}
                    />
                </div>
            </Show>

            <div class="relative z-10 flex h-full flex-col justify-start gap-3 p-3">
                <div
                    class="flex items-center justify-between text-[10px] uppercase tracking-[0.32em]"
                    style={{ color: hexToRgba(props.theme.primary, 0.85) }}
                >
                    <span>{slotLabel}</span>
                    <Show when={props.slot.role !== undefined}>
                        <RoleIcon
                            role={props.slot.role as Role}
                            class="h-[18px] w-[18px]"
                            style={{
                                color: hexToRgba(props.theme.secondary, 0.9),
                                filter: `drop-shadow(0 0 10px ${props.theme.glow})`,
                            }}
                        />
                    </Show>
                </div>

                <div class="space-y-1 text-center">
                    <div
                        class="font-champion text-lg normal-case"
                        style={{
                            color: "#F5F7FF",
                            textShadow: `0 0 18px ${props.theme.glow}`,
                        }}
                    >
                        {props.info?.label ?? "En attente"}
                    </div>
                    <Show when={props.slot.role !== undefined}>
                        <div
                            class="text-[11px] uppercase"
                            style={{
                                color: hexToRgba(props.theme.secondary, 0.75),
                            }}
                        >
                            {displayNameByRole[props.slot.role as Role]}
                        </div>
                    </Show>
                </div>
                <div class="mt-auto space-y-2 text-[10px] uppercase">
                    <div class="inline-flex items-center gap-2 rounded-full border border-neutral-700/70 bg-black/35 px-3 py-[3px] tracking-[0.28em]">
                        <span>Score</span>
                        <span class={timelineScoreClass(scoreValue())}>
                            {scoreValue() !== undefined
                                ? formatTimelineScore(scoreValue()!)
                                : "--"}
                        </span>
                    </div>
                    <Show when={roleEntries().length > 0}>
                        <div class="flex flex-wrap items-center gap-1 text-[10px] uppercase">
                            <For each={roleEntries()}>
                                {([role, probability]) => {
                                    const percent = Math.round(probability * 100);
                                    const locked = props.slot.role === role;
                                    return (
                                        <button
                                            type="button"
                                            class={cn(
                                                "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] transition-colors",
                                                locked
                                                    ? "border-primary-400 bg-primary-500/20 text-primary-100"
                                                    : "border-neutral-600/70 bg-black/30 text-neutral-300 hover:border-primary-400/60 hover:text-primary-200"
                                            )}
                                            onClick={(event) =>
                                                handleRoleClick(event, role)
                                            }
                                        >
                                            <RoleIcon role={role} class="h-4 w-4" />
                                            <span>{percent}%</span>
                                        </button>
                                    );
                                }}
                            </For>
                        </div>
                    </Show>
                </div>
            </div>
        </button>
    );
};

export default DraftTimeline;

function timelineScoreClass(value: number | undefined) {
    if (value === undefined) return "text-neutral-300";
    if (value > 0.01) return "text-emerald-300";
    if (value < -0.01) return "text-rose-300";
    return "text-neutral-300";
}

function formatTimelineScore(value: number) {
    const rounded = value.toFixed(2);
    return value >= 0 ? `+${rounded}` : rounded;
}

