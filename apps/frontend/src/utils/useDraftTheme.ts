import { createMemo } from "solid-js";
import { Team } from "@draftgap/core/src/models/Team";
import { useDraft } from "../contexts/DraftContext";
import { useDraftAnalysis } from "../contexts/DraftAnalysisContext";
import { NEON_THEMES } from "./neonTheme";

export const useDraftNeonThemes = () => {
    const { currentTurn, selection } = useDraft();
    const { allyDraftEvaluation, opponentDraftEvaluation } =
        useDraftAnalysis();

    const activeTeam = createMemo<Team>(() => {
        const turn = currentTurn();
        if (turn) return turn.team;
        const focusedTeam = selection.team as Team | undefined;
        return focusedTeam ?? "ally";
    });

    const advantageTeam = createMemo<Team | undefined>(() => {
        const ally = allyDraftEvaluation();
        const opponent = opponentDraftEvaluation();
        if (!ally || !opponent) return undefined;
        return ally.totalScore >= opponent.totalScore ? "ally" : "opponent";
    });

    const activeTheme = createMemo(() => NEON_THEMES[activeTeam()]);
    const advantageTheme = createMemo(() =>
        advantageTeam() ? NEON_THEMES[advantageTeam()!] : activeTheme()
    );

    return {
        activeTeam,
        activeTheme,
        advantageTeam,
        advantageTheme,
    };
};

