<script lang="ts">
	import { writable, type Readable } from 'svelte/store';
	import { connect, DECODER, type MonocleData, type MonocleDfu } from './lib/monocle';
	import { notifications } from './lib/notifications';
	import { debounced } from './lib/util';

	import Toast from './lib/Notifications.svelte';

	const text = writable('Text');
	const total: Readable<string> = debounced(text, 250);

	$: {
		if (monocle){
			const cmd: string = `import display; display.text("${$total}", 0, 0, 0xFFFFFF); display.show()\r`;
			console.log(cmd);
			(monocle as MonocleData).repl(cmd)
		}
		console.log($total);
	}

	let monocle: MonocleData | MonocleDfu | undefined = undefined;

	async function load() {
		try {
			monocle = await connect();
			console.log(monocle.server.device);
			monocle.disconnected = () => {
				if (monocle) {
					notifications.danger('Monocle Disconnected', 5000);
				}
				monocle = undefined;
			};

			if (monocle.kind === 'data') {
				await monocle.set_raw(true)
				monocle.data_read = (data: DataView) => {
					console.log(DECODER.decode(data));
				};
			} else {
				throw "Monocle is in DFU mode."
			}
		} catch (e: any) {
			console.log(e);
			notifications.danger(e, 5000);
		}
	}
	function unload() {
		var m = monocle;
		monocle = undefined;
		m?.server.disconnect();
	}
</script>

<Toast />
{#if !monocle}
	<button on:click={load}>Connect</button>
{:else}
	<button on:click={unload}>Disconect</button>
	<input bind:value={$text} />
{/if}
