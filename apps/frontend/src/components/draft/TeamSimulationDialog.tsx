import { For, Show, createMemo } from "solid-js";
import { useDraft } from "../../contexts/DraftContext";
import { useDataset } from "../../contexts/DatasetContext";
import { useUser } from "../../contexts/UserContext";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "../common/Dialog";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const TeamSelect = (props: {
    label: string;
    value: string | undefined;
    options: string[];
    onChange: (value: string | undefined) => void;
}) => (
    <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wide text-neutral-400">
            {props.label}
        </span>
        <select
            class="w-full rounded-md border border-neutral-700 bg-neutral-900/80 px-2 py-1 text-xs uppercase text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
            aria-label={`Selection equipe ${props.label}`}
            value={props.value ?? ""}
            onInput={(event) =>
                props.onChange(
                    event.currentTarget.value === ""
                        ? undefined
                        : event.currentTarget.value
                )
            }
        >
            <option value="">Toutes les equipes</option>
            <For each={props.options}>
                {(team) => <option value={team}>{team}</option>}
            </For>
        </select>
    </label>
);

export function TeamSimulationDialog(props: Props) {
    const { config } = useUser();
    const { proTeams } = useDataset();
    const {
        allyProTeam,
        opponentProTeam,
        setAllyProTeam,
        setOpponentProTeam,
    } = useDraft();

    const teamOptions = createMemo(() => proTeams());
    const showControls = createMemo(
        () => config.dataSource === "pro" && teamOptions().length > 0
    );

    return (
        <Show when={showControls()}>
            <Dialog open={props.open} onOpenChange={props.onOpenChange}>
                <DialogContent class="max-w-lg space-y-5">
                    <DialogHeader>
                        <DialogTitle class="text-2xl uppercase">
                            Equipes professionnelles
                        </DialogTitle>
                    </DialogHeader>
                    <div class="space-y-2 text-sm text-neutral-300">
                        <p>
                            Selectionnez les equipes pour personnaliser les
                            recommandations en fonction de leurs habitudes de
                            draft.
                        </p>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <TeamSelect
                            label="Equipe ally"
                            value={allyProTeam() ?? undefined}
                            options={teamOptions()}
                            onChange={setAllyProTeam}
                        />
                        <TeamSelect
                            label="Equipe opponent"
                            value={opponentProTeam() ?? undefined}
                            options={teamOptions()}
                            onChange={setOpponentProTeam}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </Show>
    );
}
