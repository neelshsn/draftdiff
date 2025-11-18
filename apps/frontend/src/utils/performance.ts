import { DraftResult } from "@draftgap/core/src/draft/analysis";
import { ChampionRolePerformance } from "@draftgap/core/src/models/dataset/ChampionRoleData";
import { Dataset } from "@draftgap/core/src/models/dataset/Dataset";
import { Role } from "@draftgap/core/src/models/Role";
import { ratingToWinrate, winrateToRating } from "@draftgap/core/src/rating/ratings";

function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

type RoleStats = {
    performance?: ChampionRolePerformance;
    wins: number;
    games: number;
};

function getRoleStats(
    dataset: Dataset | undefined,
    championKey: string,
    role: Role
): RoleStats | undefined {
    if (!dataset) return undefined;
    const champion = dataset.championData[championKey];
    if (!champion) return undefined;
    const roleData = champion.statsByRole?.[role];
    if (!roleData) return undefined;

    return {
        performance: roleData.performance,
        wins: roleData.wins ?? 0,
        games: roleData.games ?? 0,
    };
}

function getChampionBaseRating(
    draftResult: DraftResult | undefined,
    championKey: string,
    role: Role,
    fallbackWinrate?: number
) {
    const rating = draftResult?.allyChampionRating.championResults.find(
        (result) => result.championKey === championKey && result.role === role
    )?.rating;

    if (rating !== undefined) {
        return rating;
    }

    if (fallbackWinrate && fallbackWinrate > 0) {
        return winrateToRating(fallbackWinrate);
    }

    return undefined;
}

function getDuoContribution(
    draftResult: DraftResult | undefined,
    championKey: string,
    role: Role
) {
    if (!draftResult) return 0;

    return draftResult.allyDuoRating.duoResults.reduce((total, duo) => {
        if (duo.championKeyA === championKey && duo.roleA === role) {
            return total + duo.rating / 2;
        }
        if (duo.championKeyB === championKey && duo.roleB === role) {
            return total + duo.rating / 2;
        }
        return total;
    }, 0);
}

function getMatchupContribution(
    draftResult: DraftResult | undefined,
    championKey: string,
    role: Role
) {
    if (!draftResult) return 0;

    return draftResult.matchupRating.matchupResults.reduce((total, matchup) => {
        if (matchup.championKeyA === championKey && matchup.roleA === role) {
            return total + matchup.rating;
        }
        return total;
    }, 0);
}

type ContextualPerformanceOptions = {
    dataset?: Dataset;
    dataset30Days?: Dataset;
    draftResult?: DraftResult;
    championKey?: string;
    role?: Role;
};

export function getContextualPerformance({
    dataset,
    dataset30Days,
    draftResult,
    championKey,
    role,
}: ContextualPerformanceOptions): ChampionRolePerformance | undefined {
    if (!championKey || role === undefined) return undefined;

    const primaryStats = getRoleStats(dataset, championKey, role);
    const fallbackStats = getRoleStats(dataset30Days, championKey, role);
    const roleStats = primaryStats ?? fallbackStats;

    if (!roleStats) {
        return undefined;
    }

    const basePerformance = roleStats.performance ?? fallbackStats?.performance;
    if (!basePerformance) {
        return undefined;
    }

    const statsForWinrate = roleStats.performance ? roleStats : fallbackStats ?? roleStats;
    const baseGames = statsForWinrate?.games ?? 0;
    const baseWins = statsForWinrate?.wins ?? 0;
    const fallbackWinrate = baseGames > 0 ? baseWins / baseGames : undefined;

    const baseRating = getChampionBaseRating(
        draftResult,
        championKey,
        role,
        fallbackWinrate
    );

    if (baseRating === undefined) {
        return basePerformance;
    }

    const duoContribution = getDuoContribution(draftResult, championKey, role);
    const matchupContribution = getMatchupContribution(
        draftResult,
        championKey,
        role
    );

    const contextualRating = baseRating + duoContribution + matchupContribution;
    const baseWinrate = ratingToWinrate(baseRating);
    const contextualWinrate = ratingToWinrate(contextualRating);

    if (baseWinrate <= 0 || contextualWinrate <= 0) {
        return basePerformance;
    }

    const ratio = clamp(contextualWinrate / baseWinrate, 0.6, 1.4);
    const inverseRatio = clamp(baseWinrate / contextualWinrate, 0.6, 1.4);

    return {
        killsPerGame: basePerformance.killsPerGame * ratio,
        deathsPerGame: basePerformance.deathsPerGame * inverseRatio,
        assistsPerGame: basePerformance.assistsPerGame * ratio,
        csPerMinute: basePerformance.csPerMinute * ratio,
        visionScorePerMinute:
            basePerformance.visionScorePerMinute * ratio,
        sampleSize: basePerformance.sampleSize,
    } satisfies ChampionRolePerformance;
}
