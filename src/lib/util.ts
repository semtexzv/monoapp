import { derived, type Readable } from "svelte/store";

export function debounced<V, T extends Readable<V>>(value: T, timeout: number = 1000): Readable<V> {
    return derived(value, ($value, set) => {
        const timeoutId = setTimeout(() => {
            console.log($value);
            return set($value);
        }, timeout);

        return () => clearTimeout(timeoutId);
    })
}