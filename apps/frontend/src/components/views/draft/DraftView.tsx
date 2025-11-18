import {
    type Accessor,
    Component,
    For,
    Show,
    createMemo,
    createSignal,
    type JSX,
} from "solid-js";
import { useDraft } from "../../../contexts/DraftContext";
import { useDataset } from "../../../contexts/DatasetContext";
import { useUser } from "../../../contexts/UserContext";
import { championName } from "../../../utils/i18n";
import { DraftTimeline } from "../../draft/DraftTimeline";
import QuickPickRecommendations, { RecommendationEntry } from "../../draft/QuickPickRecommendations";
import { Icon } from "solid-heroicons";
import {
    arrowUpCircle,
    eye,
    noSymbol,
    shieldCheck,
    sparkles,
    arrowsRightLeft,
    bolt,
    exclamationTriangle,
    questionMarkCircle,
} from "solid-heroicons/solid";
import { RoleIcon } from "../../icons/roles/RoleIcon";
import { displayNameByRole } from "@draftgap/core/src/models/Role";
import { ChampionIcon } from "../../icons/ChampionIcon";
import {
    createNeonSurface,
    hexToRgba,
    type NeonTheme,
} from "../../../utils/neonTheme";
import { useDraftNeonThemes } from "../../../utils/useDraftTheme";

const STATUS_LABEL: Record<RecommendationEntry["status"], string> = {
    eligible: "Disponible",
    banned: "Banni",
    picked: "Deja pris",
};

const MANUAL_REASON_PRIORITY = [
    "reliability",
    "blind",
    "flex",
    "synergy",
    "counter",
    "deny",
    "exposure",
];

const REASON_ICON_MAP: Record<string, typeof sparkles> = {
    reliability: shieldCheck,
    blind: eye,
    flex: arrowsRightLeft,
    synergy: sparkles,
    counter: bolt,
    deny: noSymbol,
    exposure: exclamationTriangle,
};

function selectTopReasons(tags: RecommendationEntry["reasonTags"]) {
    const map = new Map<string, RecommendationEntry["reasonTags"][number]>();
    for (const tag of tags) {
        if (!map.has(tag.id) || Math.abs(tag.value) > Math.abs(map.get(tag.id)!.value)) {
            map.set(tag.id, tag);
        }
    }
    const ordered: RecommendationEntry["reasonTags"][number][] = [];
    for (const key of MANUAL_REASON_PRIORITY) {
        const tag = map.get(key);
        if (tag && Math.abs(tag.value) >= 0.05) {
            ordered.push(tag);
            map.delete(key);
        }
    }
    const remaining = Array.from(map.values()).sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value)
    );
    return [...ordered, ...remaining].slice(0, 3);
}

function reasonPalette(value: number) {
    const clamped = Math.max(-2, Math.min(2, value));
    const ratio = (clamped + 2) / 4;
    const hue = Math.round(120 * ratio);
    const light = value >= 0 ? 58 : 52;
    return {
        text: `hsl(${hue}, 80%, ${light}%)`,
        background: `hsla(${hue}, 85%, 45%, 0.18)`,
        border: `hsla(${hue}, 85%, 55%, 0.45)`,
    };
}

const formatScore = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

const formatPercent = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "0%";
    const pct = value * 100;
    const precision = pct >= 10 ? 1 : 2;
    return `${pct.toFixed(precision)}%`;
};

const DraftView: Component = () => {
    const { dataset } = useDataset();
    const { config } = useUser();
    const { currentTurn, pickChampion } = useDraft();
    const { activeTheme, advantageTheme, advantageTeam } =
        useDraftNeonThemes();

    const championLabel = (championKey: string) => {
        const champion = dataset()?.championData[championKey];
        return champion ? championName(champion, config) : championKey;
    };

    const championArtId = (championKey: string) =>
        dataset()?.championData[championKey]?.id ?? championKey;

    const championLoadingSplash = (championKey: string) => {
        const id = championArtId(championKey);
        const normalized = id === "Fiddlesticks" ? "FiddleSticks" : id;
        return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${normalized}_0.jpg`;
    };

    const [manualEntries, setManualEntries] = createSignal<RecommendationEntry[]>([]);

    const handleManualPick = (entry: RecommendationEntry) => {
        const turn = currentTurn();
        if (!turn) return;
        pickChampion(turn.team, turn.index, entry.championKey, entry.breakdown.role);
    };
    const quickPickSurface = createNeonSurface(activeTheme, {
        spotlight: 0.34,
        baseAlpha: 0.72,
    });
    const manualTheme = createMemo(() =>
        advantageTeam() ? advantageTheme() : activeTheme()
    );
    const manualSurface = createNeonSurface(manualTheme, {
        spotlight: 0.36,
        baseAlpha: 0.74,
    });
    const manualHeaderStyle = createMemo(() => ({
        borderBottom: `1px solid ${hexToRgba(manualTheme().secondary, 0.28)}`,
        background: `linear-gradient(120deg, ${hexToRgba(
            manualTheme().primary,
            0.16
        )} 0%, rgba(8,12,18,0.85) 100%)`,
    }));
    const manualScrollStyle = createMemo(() => ({
        background: `radial-gradient(circle at 10% 15%, ${hexToRgba(
            manualTheme().primary,
            0.12
        )}, transparent 45%), radial-gradient(circle at 90% 12%, ${hexToRgba(
            manualTheme().secondary,
            0.08
        )}, transparent 55%)`,
    }));
    const gridStyle = createMemo(() => ({
        background: `radial-gradient(circle at 20% 0%, ${hexToRgba(
            activeTheme().primary,
            0.08
        )}, transparent 40%), radial-gradient(circle at 80% 0%, ${hexToRgba(
            advantageTheme().secondary,
            0.08
        )}, transparent 45%)`,
    }));

    return (
        <div class="flex h-full flex-col overflow-hidden">
            <div class="px-4 pb-4 pt-3 xl:px-8">
                <DraftTimeline />
            </div>
            <div class="flex-1 overflow-hidden px-4 pb-6 xl:px-8">
                <div
                    class="grid h-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]"
                    style={gridStyle()}
                >
                    <div
                        class="relative flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300"
                        style={quickPickSurface.style()}
                        onPointerEnter={quickPickSurface.onPointerEnter}
                        onPointerMove={quickPickSurface.onPointerMove}
                        onPointerLeave={quickPickSurface.onPointerLeave}
                    >
                        <QuickPickRecommendations onEntriesChange={setManualEntries} />
                    </div>
                    <ManualChampionList
                        entries={manualEntries()}
                        championLabel={championLabel}
                        championSplash={championLoadingSplash}
                        onPick={handleManualPick}
                        surface={manualSurface}
                        headerStyle={manualHeaderStyle}
                        scrollStyle={manualScrollStyle}
                        theme={manualTheme}
                    />
                </div>
            </div>
        </div>
    );
};

const ManualChampionList: Component<{
    entries: RecommendationEntry[];
    championLabel: (championKey: string) => string;
    championSplash: (championKey: string) => string;
    onPick: (pick: RecommendationEntry) => void;
    surface: ReturnType<typeof createNeonSurface>;
    headerStyle: Accessor<JSX.CSSProperties>;
    scrollStyle: Accessor<JSX.CSSProperties>;
    theme: Accessor<NeonTheme>;
}> = (props) => {
    let scrollRef: HTMLDivElement | undefined;

    const statusIcons = (pick: RecommendationEntry) => {
        const icons: { icon: typeof sparkles; label: string }[] = [];
        if (pick.isMeta) icons.push({ icon: sparkles, label: "Meta" });
        icons.push({
            icon: pick.isBlind ? eye : questionMarkCircle,
            label: pick.isBlind ? "Blind" : "Pas blind",
        });
        if (pick.breakdown.reliability > 0.1) icons.push({ icon: shieldCheck, label: "Fiable" });
        if (Math.abs(pick.exposureScore) > 0.05)
            icons.push({ icon: exclamationTriangle, label: "Risque" });
        if (pick.status === "banned") icons.push({ icon: noSymbol, label: "Banni" });
        return icons;
    };

    return (
        <aside
            class="relative flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300"
            style={props.surface.style()}
            onPointerEnter={props.surface.onPointerEnter}
            onPointerMove={props.surface.onPointerMove}
            onPointerLeave={props.surface.onPointerLeave}
        >
            <div
                class="flex items-center justify-end px-4 py-3"
                style={props.headerStyle()}
            >
                <button
                    type="button"
                    class="rounded-full border px-2 py-1 text-xs uppercase tracking-[0.24em] text-[#A3BCFF] transition hover:text-[#ffffff]"
                    style={{
                        borderColor: hexToRgba(props.theme().primary, 0.4),
                        boxShadow: `0 0 12px -6px ${props.theme().glow}`,
                    }}
                    onClick={() => scrollRef?.scrollTo({ top: 0, behavior: "smooth" })}
                >
                    <Icon path={arrowUpCircle} class="w-5" />
                </button>
            </div>
            <div
                ref={scrollRef}
                class="no-scrollbar flex-1 overflow-y-auto px-2 py-2"
                style={props.scrollStyle()}
            >
                <Show
                    when={props.entries.length}
                    fallback={
                        <div class="px-4 py-12 text-center text-sm text-[#7c8fb3]">
                            Aucun champion disponible pour cette combinaison de filtres.
                        </div>
                    }
                >
                    <div class="flex flex-col gap-2">
                        <For each={props.entries}>
                            {(entry) => {
                                const disabled = entry.status !== "eligible";
                                const splash = props.championSplash(entry.championKey);
                                const reasons = selectTopReasons(entry.reasonTags);
                                return (
                                    <button
                                        type="button"
                                        class="relative overflow-hidden rounded-xl px-3 py-4 text-left transition-all duration-300"
                                        classList={{ "opacity-40": disabled, "cursor-not-allowed": disabled }}
                                        disabled={disabled}
                                        style={{
                                            border: `1px solid ${hexToRgba(
                                                props.theme().primary,
                                                disabled ? 0.14 : 0.32
                                            )}`,
                                            backgroundImage: `url(${splash})`,
                                            backgroundSize: "cover",
                                            backgroundPosition: "center top",
                                            boxShadow: disabled
                                                ? `0 0 12px -10px ${props.theme().glow}`
                                                : `0 12px 32px -20px ${props.theme().glow}`,
                                        }}
                                        onMouseEnter={(evt) =>
                                            (evt.currentTarget.style.boxShadow = `0 18px 40px -24px ${props.theme().glow}`)
                                        }
                                        onMouseLeave={(evt) =>
                                            (evt.currentTarget.style.boxShadow = disabled
                                                ? `0 0 12px -10px ${props.theme().glow}`
                                                : `0 12px 32px -20px ${props.theme().glow}`)
                                        }
                                        onClick={() => !disabled && props.onPick(entry)}
                                    >
                                        <div class="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/85" />
                                        <div class="relative z-10 flex w-full flex-col gap-3">
                                            <div class="flex items-start justify-between gap-4">
                                                <div class="flex items-center gap-3">
                                                    <RoleIcon
                                                        role={entry.role}
                                                        class="h-6 w-6"
                                                        style={{
                                                            color: hexToRgba(props.theme().primary, 0.9),
                                                            filter: `drop-shadow(0 0 10px ${props.theme().glow})`,
                                                        }}
                                                    />
                                                    <div class="space-y-1">
                                                        <span class="text-[10px] uppercase tracking-[0.28em] text-[#8ca0c8]">
                                                            {entry.roleLabel}
                                                        </span>
                                                        <div
                                                            class="font-champion text-lg font-semibold text-[#E5F2FF]"
                                                            style={{ textShadow: `0 0 14px ${props.theme().glow}` }}
                                                        >
                                                            {props.championLabel(entry.championKey)}
                                                        </div>
                                                        <Show when={entry.flexRoles.length}>
                                                            <div class="text-[10px] uppercase tracking-[0.24em] text-[#9fb4db]">
                                                                Flex {displayNameByRole[entry.flexRoles[0].role]}{" "}
                                                                {Math.round(entry.flexRoles[0].share * 100)}%
                                                            </div>
                                                        </Show>
                                                    </div>
                                                </div>
                                                <div class="text-right text-sm font-semibold text-[#C7E5FF] drop-shadow-[0_0_12px_rgba(94,190,255,0.45)]">
                                                    {formatScore(entry.lookaheadDelta)}
                                                    <div class="text-[10px] uppercase tracking-[0.24em] text-[#8ca0c8]">
                                                        Projection
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="flex flex-wrap items-center gap-2">
                                                <For each={reasons}>
                                                    {(tag) => {
                                                        const palette = reasonPalette(tag.value);
                                                        const icon = REASON_ICON_MAP[tag.id] ?? sparkles;
                                                        return (
                                                            <span
                                                                class="inline-flex items-center gap-2 rounded-full border px-2 py-[2px] text-[10px] uppercase tracking-[0.24em]"
                                                                style={{
                                                                    borderColor: palette.border,
                                                                    background: palette.background,
                                                                    color: palette.text,
                                                                }}
                                                                title={tag.label}
                                                            >
                                                                <Icon path={icon} class="h-4 w-4" />
                                                                <span>{tag.label}</span>
                                                                <span>{formatScore(tag.value)}</span>
                                                            </span>
                                                        );
                                                    }}
                                                </For>
                                            </div>
                                            <Show when={entry.synergyPartner}>
                                                {(value) => (
                                                    <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#9fb4db]">
                                                        <span>Synergie</span>
                                                        <ChampionIcon
                                                            championKey={value().championKey}
                                                            size={22}
                                                            class="overflow-hidden rounded-md border border-white/20"
                                                        />
                                                        <span>{formatScore(value().score)}</span>
                                                    </div>
                                                )}
                                            </Show>
                                            <Show when={entry.counterTarget}>
                                                {(value) => (
                                                    <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#9fb4db]">
                                                        <span>Counter</span>
                                                        <ChampionIcon
                                                            championKey={value().championKey}
                                                            size={22}
                                                            class="overflow-hidden rounded-md border border-white/20"
                                                        />
                                                        <span>{formatScore(value().score)}</span>
                                                    </div>
                                                )}
                                            </Show>
                                            <Show when={entry.denyScore > 0.05}>
                                                <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#a8d7ae]">
                                                    <span>Deny</span>
                                                    <Icon path={noSymbol} class="h-4 w-4" />
                                                    <span>{formatScore(entry.denyScore)}</span>
                                                </div>
                                            </Show>
                                            <Show when={entry.exposureScore > 0.05}>
                                                <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#ffbfa6]">
                                                    <span>Exposition</span>
                                                    <Icon path={exclamationTriangle} class="h-4 w-4" />
                                                    <span>{formatScore(-entry.exposureScore)}</span>
                                                </div>
                                            </Show>
                                            <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-[#7b8db1]">
                                                <span>Pickrate {formatPercent(entry.pickRate)}</span>
                                                <span>{STATUS_LABEL[entry.status]}</span>
                                            </div>
                                            <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#98aacf]">
                                                <For each={statusIcons(entry)}>
                                                    {(status) => (
                                                        <span class="inline-flex items-center gap-1">
                                                            <Icon path={status.icon} class="w-4" />
                                                            {status.label}
                                                        </span>
                                                    )}
                                                </For>
                                            </div>
                                        </div>
                                    </button>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </div>
        </aside>
    );
};

export default DraftView;






