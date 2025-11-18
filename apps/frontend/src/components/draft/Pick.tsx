import { Icon } from "solid-heroicons";
import { For, Show, createMemo } from "solid-js";
import { useDraft } from "../../contexts/DraftContext";
import { RoleIcon } from "../icons/roles/RoleIcon";
import { PickOptions } from "./PickOptions";
import { lockOpen, lockClosed } from "solid-heroicons/solid-mini";
import { Role, displayNameByRole } from "@draftgap/core/src/models/Role";
import { formatPercentage } from "../../utils/rating";
import { tooltip } from "../../directives/tooltip";
import { useTooltip } from "../../contexts/TooltipContext";
import { useUser } from "../../contexts/UserContext";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { useDataset } from "../../contexts/DatasetContext";
import { linkByStatsSite } from "../../utils/sites";
import { championName } from "../../utils/i18n";
tooltip;

type Props = {
    team: "ally" | "opponent";
    index: number;
};

export function Pick(props: Props) {
    const { config } = useUser();
    const {
        allyTeam,
        opponentTeam,
        selection,
        select,
        pickChampion,
        currentTurn,
        allyProTeam,
        opponentProTeam,
    } = useDraft();

    const {
        allyTeamComp,
        opponentTeamComp,
        allyTeamData,
        opponentTeamData,
        setAnalysisPick,
        analyzeHovers,
    } = useDraftAnalysis();
    const { getProTeamRoster } = useDataset();

    const allyRoster = createMemo(() => {
        const teamName = allyProTeam();
        if (!teamName) return undefined;
        const roster = getProTeamRoster(teamName);
        if (!roster) return undefined;
        return new Map<Role, string[]>(
            Array.from(roster.entries()).map(([role, names]) => [
                role as Role,
                names,
            ])
        );
    });

    const opponentRoster = createMemo(() => {
        const teamName = opponentProTeam();
        if (!teamName) return undefined;
        const roster = getProTeamRoster(teamName);
        if (!roster) return undefined;
        return new Map<Role, string[]>(
            Array.from(roster.entries()).map(([role, names]) => [
                role as Role,
                names,
            ])
        );
    });

    const { setPopoverVisible } = useTooltip();
    const picks = () => (props.team === "ally" ? allyTeam : opponentTeam);
    const championData = () =>
        props.team === "ally" ? allyTeamData() : opponentTeamData();
    const teamComp = () =>
        props.team === "ally" ? allyTeamComp() : opponentTeamComp();

    const pick = () => picks()[props.index];
    const teamCompRole = () =>
        [...(teamComp()?.entries() ?? [])].find(
            (e) => e[1] === pick().championKey
        )?.[0];

    const playerName = createMemo(() => {
        const role = pick().role;
        if (role === undefined) return undefined;
        const roster =
            props.team === "ally" ? allyRoster() : opponentRoster();
        const names = roster?.get(role);
        if (!names || !names.length) return undefined;
        return names.join(" / ");
    });

    const isSelected = () =>
        selection.team === props.team && selection.index === props.index;

    const isActiveStep = () => {
        const turn = currentTurn();
        return turn?.team === props.team && turn?.index === props.index;
    };

    const isLocked = () => Boolean(pick().championKey);

    const champion = () => {
        if (pick().championKey) {
            return championData().get(pick().championKey!);
        }

        if (pick().hoverKey && analyzeHovers()) {
            return championData().get(pick().hoverKey!);
        }

        return undefined;
    };

    const championAssetId = () => {
        const data = champion();
        if (!data) return undefined;
        return data.id === "Fiddlesticks" ? "FiddleSticks" : data.id;
    };

    const backgroundStyle = () => {
        const assetId = championAssetId();
        const style: Record<string, string> = {
            "background-image":
                "linear-gradient(135deg, rgba(10,10,12,0.95) 0%, rgba(12,12,14,0.6) 45%, rgba(6,6,8,0.92) 100%)",
        };
        if (assetId) {
            style["background-image"] = `${style["background-image"]}, url(https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${assetId}_0.jpg)`;
            style["background-size"] = "cover";
            style["background-position"] = "center";
            if (pick().hoverKey) {
                style.filter = "grayscale(1)";
            }
        }
        return style;
    };

    function setRole(role: Role | undefined) {
        pickChampion(props.team, props.index, pick().championKey, role);
    }

    const keyDownListener = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.altKey || e.metaKey) {
            return;
        }

        if ((e.target as HTMLElement).tagName === "INPUT") {
            return;
        }

        if (e.key === "b") {
            if (!champion()) {
                return;
            }
            e.preventDefault();
            const link = linkByStatsSite(
                config.defaultStatsSite,
                champion()!.id,
                [...teamComp().entries()].find(
                    ([, value]) => value === pick().championKey
                )![0] as Role
            );
            window.open(link, "_blank");
            return;
        }

        if (
            e.key === "r" ||
            e.key === "Backspace" ||
            e.key === "Delete"
        ) {
            e.preventDefault();
            pickChampion(props.team, props.index, undefined, undefined);
            return;
        }

        if (e.key === "f" && pick().championKey) {
            e.preventDefault();
            setAnalysisPick({
                team: props.team,
                championKey: pick().championKey!,
            });
        }
    };

    function onMouseOver() {
        document.addEventListener("keydown", keyDownListener);
    }

    function onMouseOut() {
        document.removeEventListener("keydown", keyDownListener);
    }

    return (
        <div
            class="group relative flex min-h-[220px] cursor-pointer overflow-hidden border border-neutral-800/60 bg-neutral-900/40 transition-all duration-300 ease-in-out"
            classList={{
                "bg-neutral-800/70": isSelected(),
                "ring-2 ring-offset-2 ring-offset-neutral-900 ring-sky-500/70":
                    isActiveStep() && props.team === "ally",
                "ring-2 ring-offset-2 ring-offset-neutral-900 ring-rose-500/70":
                    isActiveStep() && props.team === "opponent",
            }}
            onClick={() => select(props.team, props.index)}
            onMouseOver={onMouseOver}
            onMouseOut={onMouseOut}
        >
            <div
                class="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]"
                style={backgroundStyle()}
            />
            <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/75" />
            <div class="relative z-10 flex h-full w-full flex-col justify-between p-4">
                <Show
                    when={champion()}
                    fallback={
                        <div class="flex h-full flex-col justify-between gap-3">
                            <div class="flex flex-col gap-1">
                                <Show when={playerName()}>
                                    {(name) => (
                                        <span class="text-[11px] uppercase font-semibold tracking-wide text-primary-200 drop-shadow">
                                            {name()}
                                        </span>
                                    )}
                                </Show>
                                <span class="text-4xl font-semibold uppercase tracking-wide text-neutral-700">
                                    Pick {props.index + 1}
                                </span>
                            </div>
                            <span class="text-xs uppercase text-neutral-500">
                                Selectionnez un slot puis choisissez un champion
                            </span>
                        </div>
                    }
                >
                    <div class="flex h-full flex-col justify-between gap-4">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex flex-col gap-1">
                                <Show when={playerName()}>
                                    {(name) => (
                                        <span class="text-[11px] uppercase font-semibold tracking-wide text-primary-200 drop-shadow">
                                            {name()}
                                        </span>
                                    )}
                                </Show>
                                <span class="text-2xl font-semibold uppercase tracking-wide text-neutral-100 drop-shadow">
                                    {championName(champion()!, config)}
                                </span>
                                <Show when={pick().role !== undefined}>
                                    <span class="text-xs uppercase text-neutral-300">
                                        Role verrouille :{" "}
                                        {displayNameByRole[pick().role as Role]}
                                    </span>
                                </Show>
                            </div>
                            <div class="flex flex-col items-end gap-1 text-xs uppercase text-neutral-300">
                                <span class="rounded-full border border-neutral-600/70 px-3 py-1">
                                    Slot {props.index + 1}
                                </span>
                                <Show when={isLocked()}>
                                    <span class="text-emerald-300">Verrouille</span>
                                </Show>
                                <Show when={pick().hoverKey && !isLocked()}>
                                    <span class="text-amber-300">Previsualisation</span>
                                </Show>
                            </div>
                        </div>
                        <div class="space-y-3">
                            <div class="flex items-center justify-end gap-3 overflow-x-auto pb-1">
                                <For
                                    each={[
                                        ...(champion()?.probabilityByRole.entries() ?? []),
                                    ]
                                        .filter(([, prob]) => prob > 0.05)
                                        .sort(([, probA], [, probB]) => probB - probA)}
                                >
                                    {([role, probability]) => (
                                        <div
                                            class="group relative flex flex-col items-center gap-1 rounded-md bg-black/40 px-2 py-1 transition hover:bg-black/60"
                                            onClick={() => {
                                                setPopoverVisible(false);
                                                setRole(
                                                    pick().role === undefined
                                                        ? role
                                                        : undefined
                                                );
                                            }}
                                            // @ts-ignore
                                            use:tooltip={{
                                                content: (
                                                    <>
                                                        {pick().role !== undefined
                                                            ? "Champion verrouille ici, cliquez pour deverrouiller"
                                                            : "Cliquez pour verrouiller le champion sur ce role"}
                                                    </>
                                                ),
                                            }}
                                        >
                                            <RoleIcon
                                                role={role}
                                                class="h-8 lg:h-10"
                                                classList={{
                                                    "opacity-50":
                                                        teamCompRole() !== role &&
                                                        pick().role === undefined,
                                                }}
                                            />
                                            <Show when={pick().role === undefined}>
                                                <span class="text-[11px] uppercase text-neutral-300">
                                                    {formatPercentage(probability, 1)}
                                                </span>
                                            </Show>
                                            <Icon
                                                path={pick().role === undefined ? lockOpen : lockClosed}
                                                class="absolute -top-1 -right-1 w-5 text-neutral-200 transition-opacity"
                                                classList={{
                                                    "opacity-0 group-hover:opacity-80":
                                                        pick().role === undefined,
                                                }}
                                                style={{
                                                    filter:
                                                        pick().role !== undefined
                                                            ? "drop-shadow(2px 0 0 #111) drop-shadow(-2px 0 0 #111) drop-shadow(0 2px 0 #111) drop-shadow(0 -2px 0 #111)"
                                                            : undefined,
                                                }}
                                            />
                                        </div>
                                    )}
                                </For>
                            </div>
                            <div class="grid grid-cols-2 gap-2 text-[11px] uppercase tracking-wide text-neutral-300 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                <span>Analyser : F</span>
                                <span class="text-right">Reset : R</span>
                                <span>Ban rapide : B</span>
                                <span class="text-right">
                                    {pick().role !== undefined
                                        ? "Cliquez pour deverrouiller"
                                        : "Cliquez pour verrouiller"}
                                </span>
                            </div>
                        </div>
                    </div>
                </Show>
            </div>
            <div class="pointer-events-none absolute inset-0 bg-black/15 opacity-0 transition-opacity duration-300 group-hover:opacity-40" />
            <PickOptions team={props.team} index={props.index} />
        </div>
    );
}

