import {
    JSXElement,
    createContext,
    createEffect,
    createMemo,
    createSignal,
    useContext,
} from "solid-js";
import { useDraft } from "./DraftContext";
import { useUser } from "./UserContext";
import { getTeamDamageDistribution } from "@draftgap/core/src/damage-distribution/damage-distribution";
import {
    evaluateDraft,
    type DraftEvaluation,
} from "@draftgap/core/src/draft/engine";
import {
    analyzeDraft,
    type DraftResult,
} from "@draftgap/core/src/draft/analysis";
import { Team } from "@draftgap/core/src/models/Team";
import { ChampionData } from "@draftgap/core/src/models/dataset/ChampionData";
import { PickData } from "@draftgap/core/src/models/dataset/PickData";
import { Role } from "@draftgap/core/src/models/Role";
import predictRoles, {
    getTeamComps,
} from "@draftgap/core/src/role/role-predictor";
import { useDataset } from "./DatasetContext";
import { useDraftFilters } from "./DraftFiltersContext";

export function createDraftAnalysisContext() {
    const { config } = useUser();
    const {
        allyTeam,
        opponentTeam,
        selection,
        allyProTeam,
        opponentProTeam,
    } = useDraft();
    const { roleFilter, setRoleFilter } = useDraftFilters();
    const {
        isLoaded,
        dataset,
        dataset30Days,
        draftEngine,
        getProTeamDataset,
        getProTeamDataset30Days,
    } = useDataset();

    const [analyzeHovers, setAnalyzeHovers] = createSignal(false);
    const noPicksMade = createMemo(
        () =>
            allyTeam.every((pick) => pick.championKey === undefined) &&
            opponentTeam.every((pick) => pick.championKey === undefined)
    );

    const allyDataset = createMemo(() => {
        const team = allyProTeam();
        if (config.dataSource === "pro" && team) {
            const scoped = getProTeamDataset(team);
            if (scoped) return scoped;
        }
        return dataset();
    });

    const allyDataset30Days = createMemo(() => {
        const team = allyProTeam();
        if (config.dataSource === "pro" && team) {
            const scoped = getProTeamDataset30Days(team);
            if (scoped) return scoped;
        }
        return dataset30Days();
    });

    const opponentDataset = createMemo(() => {
        const team = opponentProTeam();
        if (config.dataSource === "pro" && team) {
            const scoped = getProTeamDataset(team);
            if (scoped) return scoped;
        }
        return dataset();
    });

    const opponentDataset30Days = createMemo(() => {
        const team = opponentProTeam();
        if (config.dataSource === "pro" && team) {
            const scoped = getProTeamDataset30Days(team);
            if (scoped) return scoped;
        }
        return dataset30Days();
    });


    function getTeamCompsForTeam(team: Team) {
        if (!isLoaded()) return [];

        const picks = team === "ally" ? allyTeam : opponentTeam;

        const activeDataset =
            (team === "ally" ? allyDataset() : opponentDataset()) ?? dataset();
        if (!activeDataset) return [];

        const champions = picks
            .filter(
                (pick) => pick.championKey || (pick.hoverKey && analyzeHovers())
            )
            .map((pick) => {
                const key = pick.championKey ?? pick.hoverKey!;
                const champion = activeDataset.championData[key];
                if (!champion) return undefined;
                return {
                    ...champion,
                    role: pick.role,
                };
            })
            .filter(Boolean) as (ChampionData & { role?: Role })[];

        if (!champions.length) return [];

        return getTeamComps(champions);
    }

    const allyTeamComps = createMemo(() => getTeamCompsForTeam("ally"));
    const opponentTeamComps = createMemo(() => getTeamCompsForTeam("opponent"));
    const allyTeamComp = createMemo(
        () =>
            allyTeamComps().at(0)?.[0] ??
            (new Map() as ReturnType<typeof allyTeamComps>[number][0])
    );
    const opponentTeamComp = createMemo(
        () =>
            opponentTeamComps().at(0)?.[0] ??
            (new Map() as ReturnType<typeof opponentTeamComps>[number][0])
    );

    const allyRoles = createMemo(() => predictRoles(allyTeamComps()));
    const opponentRoles = createMemo(() => predictRoles(opponentTeamComps()));

    const draftAnalysisConfig = () => ({
        ignoreChampionWinrates:
            config.dataSource === "pro" && noPicksMade()
                ? false
                : config.ignoreChampionWinrates,
        riskLevel: config.riskLevel,
        minGames: config.minGames,
    });

    const allyDraftAnalysis = createMemo<DraftResult | undefined>(() => {
        if (!isLoaded()) return undefined;
        const teamComp = allyTeamComps().at(0)?.[0];
        const enemyComp = opponentTeamComps().at(0)?.[0];
        const teamDataset = allyDataset() ?? dataset();
        const teamFullDataset = allyDataset30Days() ?? dataset30Days();
        const enemyDatasetScoped = opponentDataset() ?? dataset();
        const enemyFullDataset = opponentDataset30Days() ?? dataset30Days();
        if (
            !teamComp ||
            !enemyComp ||
            !teamDataset ||
            !teamFullDataset ||
            !enemyDatasetScoped ||
            !enemyFullDataset
        ) {
            return undefined;
        }
        return analyzeDraft(
            teamDataset,
            teamFullDataset,
            teamComp,
            enemyComp,
            draftAnalysisConfig(),
            enemyDatasetScoped,
            enemyFullDataset
        );
    });
    const opponentDraftAnalysis = createMemo<DraftResult | undefined>(() => {
        if (!isLoaded()) return undefined;
        const teamComp = opponentTeamComps().at(0)?.[0];
        const enemyComp = allyTeamComps().at(0)?.[0];
        const teamDataset = opponentDataset() ?? dataset();
        const teamFullDataset = opponentDataset30Days() ?? dataset30Days();
        const enemyDatasetScoped = allyDataset() ?? dataset();
        const enemyFullDataset = allyDataset30Days() ?? dataset30Days();
        if (
            !teamComp ||
            !enemyComp ||
            !teamDataset ||
            !teamFullDataset ||
            !enemyDatasetScoped ||
            !enemyFullDataset
        ) {
            return undefined;
        }
        return analyzeDraft(
            teamDataset,
            teamFullDataset,
            teamComp,
            enemyComp,
            draftAnalysisConfig(),
            enemyDatasetScoped,
            enemyFullDataset
        );
    });
    const allyDraftEvaluation = createMemo<DraftEvaluation | undefined>(() => {
        if (!isLoaded()) return undefined;
        const engine = draftEngine();
        const teamComp = allyTeamComps().at(0)?.[0];
        const enemyComp = opponentTeamComps().at(0)?.[0];
        if (
            !teamComp ||
            !enemyComp ||
            !engine
        ) {
            return undefined;
        }
        return evaluateDraft(
            engine,
            teamComp,
            enemyComp
        );
    });
    const opponentDraftEvaluation = createMemo<DraftEvaluation | undefined>(() => {
        if (!isLoaded()) return undefined;
        const engine = draftEngine();
        const teamComp = opponentTeamComps().at(0)?.[0];
        const enemyComp = allyTeamComps().at(0)?.[0];
        if (!teamComp || !enemyComp || !engine) {
            return undefined;
        }
        return evaluateDraft(engine, teamComp, enemyComp);
    });

    const allyDamageDistribution = createMemo(() => {
        if (!isLoaded()) return undefined;
        if (!allyTeamComps().length) return undefined;
        const source = allyDataset() ?? dataset();
        if (!source) return undefined;
        return getTeamDamageDistribution(source, allyTeamComps()[0][0]);
    });

    const opponentDamageDistribution = createMemo(() => {
        if (!isLoaded()) return undefined;
        if (!opponentTeamComps().length) return undefined;
        const source = opponentDataset() ?? dataset();
        if (!source) return undefined;
        return getTeamDamageDistribution(source, opponentTeamComps()[0][0]);
    });

    function getTeamData(team: Team): Map<string, PickData> {
        if (!isLoaded()) return new Map();

        const picks = team === "ally" ? allyTeam : opponentTeam;
        const roles = team === "ally" ? allyRoles() : opponentRoles();
        const activeDataset =
            (team === "ally" ? allyDataset() : opponentDataset()) ?? dataset();
        if (!activeDataset) return new Map();

        const teamData = new Map<string, PickData>();

        for (const pick of picks) {
            if (!pick.championKey && (!pick.hoverKey || !analyzeHovers()))
                continue;

            const key = pick.championKey ?? pick.hoverKey!;

            let championData: ChampionData | undefined = activeDataset.championData[key];
            if (!championData) {
                championData =
                    dataset()?.championData[key] ??
                    dataset30Days()?.championData[key] ??
                    undefined;
            }
            if (!championData) continue;
            const resolvedChampion = championData as ChampionData;
            const probabilityByRole = roles.get(key) ?? new Map();
            teamData.set(key, {
                ...resolvedChampion,
                probabilityByRole,
            });
        }

        return teamData;
    }

    const allyTeamData = createMemo(() => getTeamData("ally"));
    const opponentTeamData = createMemo(() => getTeamData("opponent"));

    const getLockedRoles = (team: Team) => {
        if (!selection.team) return new Set();
        const teamDraft = team === "ally" ? allyTeam : opponentTeam;

        return new Set(teamDraft.map((p) => p.role));
    };
    const getFilledRoles = (team: Team) => {
        if (!selection.team) return new Set();

        const teamComp =
            team === "ally"
                ? allyTeamComps().at(0)?.[0]
                : opponentTeamComps().at(0)?.[0];
        if (!teamComp) return new Set();

        return new Set(teamComp.keys());
    };

    createEffect(() => {
        if (!selection.team) return;

        const filledRoles = getFilledRoles(selection.team!);
        if (roleFilter() !== undefined && filledRoles.has(roleFilter())) {
            setRoleFilter(undefined);
        }
    });

    const [analysisPick, _setAnalysisPick] = createSignal<{
        team: Team;
        championKey: string;
    }>();
    const [showAnalysisPick, setShowAnalysisPick] = createSignal(false);

    function setAnalysisPick(
        pick: { team: Team; championKey: string } | undefined
    ) {
        if (!pick) {
            setShowAnalysisPick(false);
            return;
        }
        _setAnalysisPick(pick);
        setShowAnalysisPick(true);
    }

    return {
        allyTeamData,
        opponentTeamData,
        allyDraftAnalysis,
        opponentDraftAnalysis,
        allyDamageDistribution,
        opponentDamageDistribution,
        allyDataset,
        opponentDataset,
        allyDataset30Days,
        opponentDataset30Days,
        allyTeamComps,
        opponentTeamComps,
        allyTeamComp,
        opponentTeamComp,
        allyRoles,
        opponentRoles,
        getLockedRoles,
        getFilledRoles,
        allyDraftEvaluation,
        opponentDraftEvaluation,
        draftAnalysisConfig,
        analysisPick,
        showAnalysisPick,
        setAnalysisPick,
        analyzeHovers,
        setAnalyzeHovers,
    };
}

export const DraftAnalysisContext =
    createContext<ReturnType<typeof createDraftAnalysisContext>>();

export function DraftAnalysisProvider(props: { children: JSXElement }) {
    return (
        <DraftAnalysisContext.Provider value={createDraftAnalysisContext()}>
            {props.children}
        </DraftAnalysisContext.Provider>
    );
}

export function useDraftAnalysis() {
    const useCtx = useContext(DraftAnalysisContext);
    if (!useCtx) throw new Error("No DraftAnalysisContext found");

    return useCtx;
}
