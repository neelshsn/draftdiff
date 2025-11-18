import { For, createMemo } from "solid-js";
import { useDraft } from "../../contexts/DraftContext";

const TEAMS = ["ally", "opponent"] as const;

export function TeamSelector() {
    const { currentTurn } = useDraft();
    const activeTeam = createMemo(() => currentTurn()?.team);

    return (
        <span class="isolate inline-flex rounded-md shadow-sm">
            <For each={TEAMS}>
                {(team, i) => (
                    <button
                        type="button"
                        class="text-lg relative inline-flex items-center border text-neutral-300 border-neutral-700 bg-primary px-3 py-1 font-medium hover:bg-neutral-800 uppercase disabled:pointer-events-none disabled:text-neutral-700"
                        classList={{
                            "rounded-r-md": i() === TEAMS.length - 1,
                            "rounded-l-md": i() === 0,
                            "-ml-px": i() !== 0,
                            "text-white !bg-neutral-700":
                                activeTeam() === team,
                        }}
                        disabled
                    >
                        {team === "ally" ? "Blue side" : "Red side"}
                    </button>
                )}
            </For>
        </span>
    );
}
