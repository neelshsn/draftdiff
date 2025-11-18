import {
    batch,
    createContext,
    createSignal,
    JSXElement,
    useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { displayNameByRole, Role } from "@draftgap/core/src/models/Role";
import { Team } from "@draftgap/core/src/models/Team";
import { useDraftView } from "./DraftViewContext";
import { useDataset } from "./DatasetContext";
import { useDraftFilters } from "./DraftFiltersContext";

type TeamPick = {
    championKey: string | undefined;
    role: Role | undefined;
    hoverKey: string | undefined;
};

type TeamPicks = [TeamPick, TeamPick, TeamPick, TeamPick, TeamPick];

type Selection = {
    team: Team | undefined;
    index: number;
};

export const DRAFT_SEQUENCE: readonly { team: Team; index: number }[] = [
    { team: "ally", index: 0 },
    { team: "opponent", index: 0 },
    { team: "opponent", index: 1 },
    { team: "ally", index: 1 },
    { team: "ally", index: 2 },
    { team: "opponent", index: 2 },
    { team: "opponent", index: 3 },
    { team: "ally", index: 3 },
    { team: "ally", index: 4 },
    { team: "opponent", index: 4 },
] as const;

export function createDraftContext() {
    const { dataset, dataset30Days } = useDataset();
    const { setCurrentDraftView, currentDraftView } = useDraftView();
    const { resetDraftFilters } = useDraftFilters();

    const [allyTeam, setAllyTeam] = createStore<TeamPicks>([
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
    ]);
    const [opponentTeam, setOpponentTeam] = createStore<TeamPicks>([
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
        { championKey: undefined, role: undefined, hoverKey: undefined },
    ]);

    const [allyProTeam, setAllyProTeam] = createSignal<string | undefined>();
    const [opponentProTeam, setOpponentProTeam] =
        createSignal<string | undefined>();

    const [bans, setBans] = createStore<string[]>([]);
    // If empty, assume all champions are owned
    const [ownedChampions, setOwnedChampions] = createSignal<Set<string>>(
        new Set()
    );

    const getSlotPick = (slot: { team: Team; index: number }) =>
        (slot.team === "ally" ? allyTeam : opponentTeam)[slot.index];

    const isSlotFilled = (slot: { team: Team; index: number }) =>
        getSlotPick(slot).championKey !== undefined;

    const findFirstOpenSlot = () =>
        DRAFT_SEQUENCE.find((slot) => !isSlotFilled(slot));

    const currentTurn = () => findFirstOpenSlot();

    function fixClashes(team: Team, championKey: string, index: number) {
        const allyClashingChampion = allyTeam.findIndex(
            (p) => p.championKey === championKey
        );
        if (
            allyClashingChampion !== -1 &&
            (team !== "ally" || allyClashingChampion !== index)
        ) {
            resetChampion("ally", allyClashingChampion);
        }
        const opponentClashingChampion = opponentTeam.findIndex(
            (p) => p.championKey === championKey
        );
        if (
            opponentClashingChampion !== -1 &&
            (team !== "opponent" || opponentClashingChampion !== index)
        ) {
            resetChampion("opponent", opponentClashingChampion);
        }
    }

    function fixRoleClashes(team: Team, role: Role, index: number) {
        const teamPicks = team === "ally" ? allyTeam : opponentTeam;
        const setTeam = team === "ally" ? setAllyTeam : setOpponentTeam;

        const clashingRole = teamPicks.findIndex((p) => p.role === role);
        if (clashingRole !== -1 && clashingRole !== index) {
            setTeam(clashingRole, "role", undefined);
        }
    }

    function resolveTargetIndex(team: Team, desiredIndex: number | undefined) {
        const teamPicks = team === "ally" ? allyTeam : opponentTeam;
        if (
            desiredIndex !== undefined &&
            desiredIndex >= 0 &&
            desiredIndex < teamPicks.length
        ) {
            return desiredIndex;
        }

        return -1;
    }

    function pickChampion(
        team: "ally" | "opponent",
        index: number,
        championKey: string | undefined,
        role: Role | undefined,
        {
            updateSelection = true,
            resetFilters = true,
            reportEvent = true,
            updateView = true,
        } = {}
    ) {
        batch(() => {
            const championData =
                championKey !== undefined
                    ? dataset()?.championData[championKey] ??
                      dataset30Days()?.championData[championKey]
                    : undefined;

            let targetTeam: Team = team;
            let targetIndex = resolveTargetIndex(targetTeam, index);

            if (championKey !== undefined) {
                const slot = currentTurn();
                if (!slot) {
                    return;
                }
                targetTeam = slot.team;
                targetIndex = slot.index;
            }

            if (targetIndex === -1) {
                return;
            }

            const setTeam =
                targetTeam === "ally" ? setAllyTeam : setOpponentTeam;

            if (championKey !== undefined) {
                fixClashes(targetTeam, championKey, targetIndex);
                if (role !== undefined) {
                    fixRoleClashes(targetTeam, role, targetIndex);
                }
            } else if (role !== undefined) {
                fixRoleClashes(targetTeam, role, targetIndex);
            }

            setTeam(targetIndex, {
                championKey,
                role,
                hoverKey: undefined,
            });

            if (updateSelection) {
                focusCurrentSlot(resetFilters);
            } else if (resetFilters) {
                resetDraftFilters();
            }

            if (reportEvent && championKey !== undefined && championData) {
                gtag("event", "pick_champion", {
                    event_category: "draft",
                    champion_key: championKey,
                    champion_name: championData.name,
                    role,
                    role_name: role ? displayNameByRole[role] : undefined,
                });
            }

            if (
                updateView &&
                championKey !== undefined &&
                currentDraftView().type === "draft" &&
                draftFinished()
            ) {
                setCurrentDraftView({
                    type: "analysis",
                });
            }
        });
    }

    function assignRole(
        team: Team,
        index: number,
        role: Role | undefined
    ) {
        const teamPicks = team === "ally" ? allyTeam : opponentTeam;
        const setTeam = team === "ally" ? setAllyTeam : setOpponentTeam;
        const current = teamPicks[index];
        if (!current || !current.championKey) {
            return;
        }
        if (role !== undefined) {
            fixRoleClashes(team, role, index);
        }
        setTeam(index, "role", role);
        setTeam(index, "hoverKey", undefined);
    }

    function hoverChampion(
        team: "ally" | "opponent",
        index: number,
        championKey: string | undefined,
        role: Role | undefined
    ) {
        batch(() => {
            let targetTeam: Team = team;
            let targetIndex = resolveTargetIndex(targetTeam, index);

            if (championKey !== undefined) {
                const slot = currentTurn();
                if (!slot) {
                    return;
                }
                targetTeam = slot.team;
                targetIndex = slot.index;
            }

            if (targetIndex === -1) {
                return;
            }

            const setTeam =
                targetTeam === "ally" ? setAllyTeam : setOpponentTeam;

            if (championKey !== undefined) {
                fixClashes(targetTeam, championKey, targetIndex);
            }

            if (championKey !== undefined && role !== undefined) {
                fixRoleClashes(targetTeam, role, targetIndex);
            }

            setTeam(targetIndex, {
                championKey: undefined,
                role,
                hoverKey: championKey,
            });
        });
    }

    const resetChampion = (team: "ally" | "opponent", index: number) => {
        pickChampion(team, index, undefined, undefined, {
            updateSelection: false,
            resetFilters: false,
        });
    };

    const resetTeam = (team: "ally" | "opponent") => {
        batch(() => {
            for (let i = 0; i < 5; i++) {
                resetChampion(team, i);
            }

            select(team, 0);
        });
    };

    const resetAll = () => {
        batch(() => {
            resetTeam("ally");
            resetTeam("opponent");
            setBans([]);
        });
    };

    const banChampion = (championKey: string) => {
        if (bans.includes(championKey)) {
            return;
        }

        if (bans.length >= 50) {
            return;
        }

        setBans([...bans, championKey]);
    };

    const unbanChampion = (championKey: string) => {
        if (!bans.includes(championKey)) {
            return;
        }

        setBans(bans.filter((ban) => ban !== championKey));
    };

    const toggleBan = (championKey: string) => {
        if (bans.includes(championKey)) {
            unbanChampion(championKey);
            return;
        }

        banChampion(championKey);
    };

    const initialSlot = DRAFT_SEQUENCE[0];
    const [selection, setSelection] = createStore<Selection>({
        team: initialSlot.team,
        index: initialSlot.index,
    });

    function focusCurrentSlot(resetFilters = true) {
        const slot = currentTurn();
        setSelection("team", slot?.team);
        setSelection("index", slot?.index ?? 0);
        if (resetFilters) {
            resetDraftFilters();
        }
        if (currentDraftView().type === "draft") {
            setCurrentDraftView({
                type: "draft",
                subType: slot?.team ?? "draft",
            });
        }
    }

    function draftFinished() {
        return currentTurn() === undefined;
    }

    const select = (
        team: Team | undefined,
        index?: number,
        resetFilters = true
    ) => {
        if (!draftFinished()) {
            focusCurrentSlot(resetFilters);
            return;
        }

        setSelection("team", team);
        setSelection("index", index ?? 0);
        if (resetFilters) {
            resetDraftFilters();
        }

        setCurrentDraftView({
            type: "draft",
            subType: team ?? "draft",
        });
    };

    return {
        allyTeam,
        opponentTeam,
        allyProTeam,
        opponentProTeam,
        setAllyProTeam,
        setOpponentProTeam,
        bans,
        setBans,
        banChampion,
        unbanChampion,
        toggleBan,
        ownedChampions,
        setOwnedChampions,
        pickChampion,
        assignRole,
        hoverChampion,
        resetChampion,
        resetTeam,
        resetAll,
        selection,
        select,
        draftFinished,
        currentTurn,
    };
}

const DraftContext = createContext<ReturnType<typeof createDraftContext>>();

export function DraftProvider(props: { children: JSXElement }) {
    const ctx = createDraftContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DRAFTGAP_DEBUG = ((window as any).DRAFTGAP_DEBUG = ctx) as any;
    DRAFTGAP_DEBUG.test = () => {
        batch(() => {
            DRAFTGAP_DEBUG.pickChampion("ally", 0, "57", 0);
            DRAFTGAP_DEBUG.pickChampion("ally", 1, "234", 1);
            DRAFTGAP_DEBUG.pickChampion("ally", 2, "30", 2);
            DRAFTGAP_DEBUG.pickChampion("ally", 3, "429", 3);
            DRAFTGAP_DEBUG.pickChampion("ally", 4, "412", 4);

            DRAFTGAP_DEBUG.pickChampion("opponent", 0, "164", 0);
            DRAFTGAP_DEBUG.pickChampion("opponent", 1, "64", 1);
            DRAFTGAP_DEBUG.pickChampion("opponent", 2, "147", 2);
            DRAFTGAP_DEBUG.pickChampion("opponent", 3, "145", 3);
            DRAFTGAP_DEBUG.pickChampion("opponent", 4, "16", 4);
        });
    };
    DRAFTGAP_DEBUG.assignRole = ctx.assignRole;

    return (
        <DraftContext.Provider value={ctx}>
            {props.children}
        </DraftContext.Provider>
    );
}

export const useDraft = () => {
    const useCtx = useContext(DraftContext);
    if (!useCtx) throw new Error("No DraftContext found");

    return useCtx;
};
