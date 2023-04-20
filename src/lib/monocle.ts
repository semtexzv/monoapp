const nordicDfuServiceUuid: BluetoothServiceUUID = 0xfe59;
const nordicDfuControlCharacteristicUUID: BluetoothCharacteristicUUID = '8ec90001-f315-4f60-9fb8-838830daea50';
const nordicDfuPacketCharacteristicUUID: BluetoothCharacteristicUUID = '8ec90002-f315-4f60-9fb8-838830daea50';

const replDataServiceUuid: BluetoothServiceUUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const replRxCharacteristicUuid: BluetoothCharacteristicUUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const replTxCharacteristicUuid: BluetoothCharacteristicUUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const rawDataServiceUuid: BluetoothServiceUUID = "e5700001-7bac-429a-b4ce-57ff900f479d";
const rawDataRxCharacteristicUuid: BluetoothCharacteristicUUID = "e5700002-7bac-429a-b4ce-57ff900f479d";
const rawDataTxCharacteristicUuid: BluetoothCharacteristicUUID = "e5700003-7bac-429a-b4ce-57ff900f479d";

const MAX_MTU = 125;
export const EMPTY = new Uint8Array(0);
export const ENCODER = new TextEncoder()
export const DECODER = new TextDecoder()

export interface Monocle {
    server: BluetoothRemoteGATTServer

    disconnected?: () => void
}

export type MonocleDfu = Monocle & {
    kind: "dfu"

    dfu: BluetoothRemoteGATTService

    dfuctr: BluetoothRemoteGATTCharacteristic
    dfupkt: BluetoothRemoteGATTCharacteristic
}

export type MonocleData = Monocle & {
    kind: "data"
    raw: boolean

    // Handles of background tasks
    repltask: number
    datatask: number

    // Sends something over the repl channel and waits for response
    repl(data: Uint8Array | ArrayBuffer | string): Promise<string>
    set_raw(raw: boolean): Promise<void>

    // Sends raw data
    data_send(data: Uint8Array | ArrayBuffer | string): void
    // Callback invoked when receiving raw data
    data_read?: (data: DataView) => void

    // Stops tasks used for transmitting
    stop(): void
}

class Bytes {
    buf: Uint8Array = EMPTY
    len = 0
    lck = false

    subarray(pos: number, len: number): Uint8Array {
        if (len > this.len) {
            throw "Out of bounds"
        }
        return this.buf.subarray(pos, pos + len)
    }

    write(buf: Uint8Array) {
        if (this.buf.length - this.len < buf.byteLength) {
            const old = this.buf;
            this.buf = new Uint8Array(this.len + buf.byteLength)
            this.buf.set(old)
        }
        this.buf.set(buf, this.len)
        this.len += buf.length
    }

    read(len: number): Uint8Array {
        return this.subarray(0, Math.min(this.len, len))
    }

    read_lock(len: number): Uint8Array {
        this.lck = true;
        return this.read(len)
    }

    advance(len: number): void {
        this.buf = this.buf.subarray(len)
        this.len -= len
    }

    advance_unlock(len: number): void {
        this.lck = false
        this.advance(len)
    }

}

function transmit(channel: BluetoothRemoteGATTCharacteristic, bytes: Bytes) {
    if (bytes.len > 0 && !bytes.lck) {
        const tmp = bytes.read_lock(MAX_MTU)
        channel.writeValueWithoutResponse(tmp)
            .then(() => bytes.advance_unlock(tmp.length))
            .catch(err => {
                // Unlock, but rethrow
                bytes.advance_unlock(tmp.length)
                Promise.reject(err)
            })
    }
}

export async function connect(): Promise<MonocleDfu | MonocleData> {
    if (!navigator.bluetooth) {
        throw "This browser doesn't support WebBluetooth. " +
        "Make sure you're on Chrome Desktop/Android or BlueFy iOS."
    }
    let device: BluetoothDevice | undefined;
    if (/iPhone|iPad/.test(navigator.userAgent)) {
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true
        });
    } else {
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [replDataServiceUuid] },
                { services: [nordicDfuServiceUuid] },
            ],
            optionalServices: [rawDataServiceUuid]
        });
    }

    const server = await device.gatt?.connect()
    if (!server) {
        throw "Bluetooth service undefined"
    }

    const dfu = await server?.getPrimaryService(nordicDfuServiceUuid).catch(() => { });

    if (dfu) {
        const dfuctr = await dfu.getCharacteristic(nordicDfuControlCharacteristicUUID)
        const dfupkt = await dfu.getCharacteristic(nordicDfuPacketCharacteristicUUID)

        const monocle: MonocleDfu = { kind: "dfu", server, dfu, dfuctr, dfupkt }

        device.ongattserverdisconnected = function () {
            if (monocle.disconnected) monocle.disconnected()
        }

        dfu.oncharacteristicvaluechanged = function (ev: Event) {
            console.log("Dfu ", ev)
        }

        return monocle
    }

    const repl = await server.getPrimaryService(replDataServiceUuid);
    const data = await server.getPrimaryService(rawDataServiceUuid);

    const replrx = await repl.getCharacteristic(replRxCharacteristicUuid)
    const repltx = await repl.getCharacteristic(replTxCharacteristicUuid)

    const datarx = await data.getCharacteristic(rawDataRxCharacteristicUuid)
    const datatx = await data.getCharacteristic(rawDataTxCharacteristicUuid)

    const replbuf = new Bytes()
    const databuf = new Bytes()

    const repltask: number = setInterval(() => transmit(replrx, replbuf));
    const datatask: number = setInterval(() => transmit(datarx, databuf));

    type ReplCallback = { repl_cb?: (data: string) => void }

    const monocle: MonocleData & ReplCallback = {
        kind: "data",
        raw: false,

        server,

        repltask,
        datatask,

        data_send(data: Uint8Array | ArrayBuffer | string) {
            if (typeof data == 'string') {
                data = ENCODER.encode(data)
            }
            replbuf.write(new Uint8Array(data))
        },

        async repl(data: Uint8Array | ArrayBuffer | string): Promise<string> {
            if (typeof data == 'string') {
                if (this.raw && /[\x20-\x7F]/.test(data)) {
                    data += '\x04'
                }
                data = ENCODER.encode(data)
            }

            replbuf.write(new Uint8Array(data))
            return new Promise(resolve => {
                this.repl_cb = (data: string) => resolve(data)
                setTimeout(() => resolve(''), 500);
            })
        },

        async set_raw(raw: boolean) {
            if (raw) {
                this.raw = true
                await this.repl('\x03\x01')
            } else {
                this.raw = false
                await this.repl('\x02')
            }
        },

        stop() {
            clearInterval(this.repltask)
            clearInterval(this.datatask)
        }
    };

    device.ongattserverdisconnected = function () {
        if (monocle.disconnected) monocle.disconnected()
    }

    let repl_str = ''
    repltx.oncharacteristicvaluechanged = (event: Event) => {
        const target = (event.target as BluetoothRemoteGATTCharacteristic)
        if (!target.value) {
            return
        }

        if (monocle.raw) {
            repl_str += DECODER.decode(target.value)

            // Once the end of response '>' is received, run the callbacks
            if (repl_str.endsWith('>') || repl_str.endsWith('>>> ')) {
                if (monocle.repl_cb) monocle.repl_cb(repl_str)
                repl_str = ''
            }
        } else {
            if (monocle.repl_cb) monocle.repl_cb(DECODER.decode(target.value))
        }
    }
    
    datatx.oncharacteristicvaluechanged = (event: Event) => {
        const target = (event.target as BluetoothRemoteGATTCharacteristic)
        if (target.value && monocle.data_read) monocle.data_read(target.value)
    }

    await repltx.startNotifications()
    await datatx.startNotifications()
    
    await monocle.set_raw(true)

    return monocle
}