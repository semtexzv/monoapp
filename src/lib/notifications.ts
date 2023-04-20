import { writable, derived, type Readable, type Writable } from "svelte/store"


interface Notification {
    id: string,
    type: string,
    message: string,
    timeout: number
}

interface Notifications extends Readable<Notification[]> {
    send: (msg: string, type: string, timeout: number) => void,
    default: (msg: string, timeout: number) => void,
    danger: (msg: string, timeout: number) => void,
    warning: (msg: string, timeout: number) => void,
    info: (msg: string, timeout: number) => void,
    success: (msg: string, timeout: number) => void,
}

function createNotificationStore(): Notifications {
    const _notifications: Writable<Notification[]> = writable<Notification[]>([])

    function send(message: string, type: string = "default", timeout: number) {
        _notifications.update(state => {
            return [...state, { id: id(), type, message, timeout }]
        })
    }

    const notifications = derived<Writable<Notification[]>, Notification[]>(_notifications, ($_notifications, set) => {
        set($_notifications)
        if ($_notifications.length > 0) {
            const timer = setTimeout(() => {
                _notifications.update(state => {
                    state.shift()
                    return state
                })
            }, $_notifications[0].timeout)
            return () => {
                clearTimeout(timer)
            }
        }
        return
    })

    const { subscribe } = notifications

    return {
        subscribe,
        send,

        default: (msg: string, timeout: number) => send(msg, "default", timeout),
        danger: (msg: string, timeout: number) => send(msg, "danger", timeout),
        warning: (msg: string, timeout: number) => send(msg, "warning", timeout),
        info: (msg: string, timeout: number) => send(msg, "info", timeout),
        success: (msg: string, timeout: number) => send(msg, "success", timeout),
    }
}

function id() {
    return '_' + Math.random().toString(36).substring(2, 9);
};

export const notifications = createNotificationStore()