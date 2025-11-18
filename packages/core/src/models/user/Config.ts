import { RiskLevel } from "../../risk/risk-level";

export type StatsSite = "op.gg" | "u.gg" | "lolalytics";

export type DataSource = "riot" | "pro";

export const DraftTablePlacement = {
    Bottom: "bottom",
    Hidden: "hidden",
    InPlace: "in-place",
} as const;
type DraftTablePlacement =
    (typeof DraftTablePlacement)[keyof typeof DraftTablePlacement];

export type DraftGapConfig = {
    // DRAFT ANALYSIS
    ignoreChampionWinrates: boolean;
    riskLevel: RiskLevel;
    minGames: number;

    // DRAFT SUGGESTIONS
    showFavouritesAtTop: boolean;
    banPlacement: DraftTablePlacement;
    unownedPlacement: DraftTablePlacement;
    showAdvancedWinrates: boolean;
    quickPickMinPickRate: number;
    language: string;

    // MISC
    defaultStatsSite: StatsSite;
    enableBetaFeatures: boolean;
    dataSource: DataSource;
    proPatch: string;

    // LOL CLIENT
    disableLeagueClientIntegration: boolean;
};
