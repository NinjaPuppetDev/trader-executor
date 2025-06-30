// utils.ts
export const formatDecision = (decision: string) => {
    try {
        const parsed = JSON.parse(decision);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return decision;
    }
};