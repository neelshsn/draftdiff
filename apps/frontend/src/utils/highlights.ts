import { ProHighlight } from "@draftgap/core/src/models/dataset/ChampionRoleData";
import { displayNameByRole, Role } from "@draftgap/core/src/models/Role";

type ParticipantLabel = {
    role: Role;
    playerName?: string;
};

function formatParticipants(participants: ParticipantLabel[]): string | undefined {
    if (!participants.length) return undefined;

    return participants
        .map((participant) => {
            const roleLabel = displayNameByRole[participant.role] ?? "";
            const nameLabel = participant.playerName ?? "Unknown";
            return `${roleLabel} - ${nameLabel}`;
        })
        .join(" / ");
}

export type HighlightSummary = {
    title: string;
    subtitle?: string;
    players?: string;
    opponents?: string;
    resultLabel: string;
    isWin: boolean;
    url?: string;
};

export function summarizeHighlight(highlight: ProHighlight): HighlightSummary {
    const title = `${highlight.team} vs ${highlight.opponent}`;

    const subtitleParts: string[] = [];
    if (highlight.league) subtitleParts.push(highlight.league);
    if (highlight.split) subtitleParts.push(highlight.split);
    if (highlight.patch) subtitleParts.push(`Patch ${highlight.patch}`);
    if (highlight.date) subtitleParts.push(highlight.date);

    const subtitle =
        subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined;

    const players = formatParticipants(highlight.players);
    const opponents = formatParticipants(highlight.opponents);

    return {
        title,
        subtitle,
        players,
        opponents,
        resultLabel: highlight.win ? "Win" : "Loss",
        isWin: highlight.win,
        url: highlight.url,
    };
}
