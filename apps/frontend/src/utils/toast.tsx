import { exclamationCircle } from "solid-heroicons/outline";
import toast from "solid-toast";
import { Toast } from "../components/common/Toast";

export const createErrorToast = (message: string) => {
    return toast.custom(
        (t) => (
            <Toast
                t={t}
                icon={exclamationCircle}
                title="Error"
                content={message}
            />
        ),
        {
            duration: 3000,
        }
    );
};

export const createMustSelectToast = () => {
    return toast.custom(
        (t) => (
            <Toast
                t={t}
                icon={exclamationCircle}
                title="No pick selected"
                content="Select a pick first by clicking on one in the draft or opponent tab."
            />
        ),
        {
            duration: 3000,
        }
    );
};

export const createRiskyPickToast = () => {
    return toast.custom(
        (t) => (
            <Toast
                t={t}
                icon={exclamationCircle}
                title="Pick risqué"
                content="Ce pick repose sur très peu de données compétitives. À confirmer selon le plan de draft."
            />
        ),
        {
            duration: 4000,
        }
    );
};
