window.__ModuleLoader__.load({
	id: '@local/dsh-turn-timer',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require('react');
		const h = react.createElement;

		/* ── locale copy ───────────────────────────────────────────────────── */

		const NS = 'turnTimer';
		const zh = {
			label: '本轮耗时',
			seconds: '{seconds} 秒',
			minutes: '{minutes} 分 {seconds} 秒',
			title: '本轮耗时 {duration}',
		};
		const en = {
			label: 'Turn time',
			seconds: '{seconds}s',
			minutes: '{minutes}m {seconds}s',
			title: 'This turn took {duration}',
		};

		/* ── formatting ───────────────────────────────────────────────────── */

		/**
		 * Duration as the chat's own duration copy does it: one decimal under a
		 * minute, whole minutes and seconds above. Hand-built rather than `Intl`:
		 * this runs inside a render pass, where a rejected locale tag throws.
		 * @param ms - elapsed milliseconds.
		 * @param t - bound locale seat.
		 * @returns the readable duration.
		 */
		function formatDuration(ms, t) {
			const seconds = ms / 1000;
			if (seconds < 60) return t('seconds', { seconds: Math.round(seconds * 10) / 10 });
			const whole = Math.round(seconds);
			return t('minutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 });
		}

		/* ── styles ───────────────────────────────────────────────────────── */
		/* Typography and geometry copied from the shipped composer stats pill
		 * (`StatsPills.module.css`) so this reads as one more pill in the dock row.
		 * The row itself sets no size; every pill carries its own. */
		const STYLE = {
			pill: {
				boxSizing: 'border-box',
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				minWidth: 0,
				maxWidth: '100%',
				padding: '1px 8px',
				borderRadius: '999px',
				color: 'var(--dsw-alias-label-tertiary)',
				fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
				lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
				fontVariantNumeric: 'tabular-nums',
				whiteSpace: 'nowrap',
			},
			icon: {
				display: 'block',
				flex: 'none',
				width: '14px',
				height: '14px',
			},
		};

		/** @returns the stopwatch glyph marking the turn time. */
		function IconStopwatch() {
			return h(
				'svg',
				{
					viewBox: '0 0 16 16',
					width: '14',
					height: '14',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.4',
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
					focusable: false,
					style: STYLE.icon,
				},
				h('circle', { cx: '8', cy: '9', r: '5.4' }),
				h('path', { d: 'M8 6.2V9l1.9 1.3' }),
				h('path', { d: 'M6.3 2h3.4M8 2v1.6' }),
			);
		}

		/* ── view ─────────────────────────────────────────────────────────── */

		/**
		 * Composer-dock entry: how long the last completed round of conversation
		 * took, read straight from the `turnTimer` projection the host half folds.
		 *
		 * @param props - the dock entry's standard props; `useProjection` reads
		 *   the session projection by key and re-renders this entry when it changes.
		 * @returns the pill, or null before the first turn completes.
		 */
		function TurnTimer(props) {
			const { useProjection, t } = props;
			const timing = useProjection('turnTimer');
			if (timing === undefined || timing.lastMs === null) return null;
			const duration = formatDuration(timing.lastMs, t);
			const title = t('title', { duration });
			return h(
				'span',
				{ style: STYLE.pill, 'data-turn-timer': true, 'data-turn-timer-turn': timing.turn },
				h(IconStopwatch),
				h('span', { title }, t('label'), ' ', duration),
			);
		}

		/* ── registration ─────────────────────────────────────────────────── */

		/* Cordis gates every service read on a declared dependency: reaching
		 * `ctx.slots` or `ctx.locale` without these entries throws
		 * "cannot get property ... without inject" at load, which fails the whole
		 * entry and — under the desktop boot policy — the whole web boot. */
		const inject = ['slots', 'locale'];

		/**
		 * Register the dock entry and its dictionaries.
		 * @param ctx - client plugin context.
		 * @returns Nothing; every disposer belongs to the context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'turn-timer: dictionaries');
			const t = ctx.locale.bind(NS);
			/* A generator, like the dock's own entries: the engine drains it so the
			 * registration's disposer belongs to the slot-owning fiber. */
			ctx.slots.inject('conversation.composer.dock', function* registerEntry() {
				yield ctx.slots.register(
					{ name: 'conversation.composer.dock', id: 'turn-timer', order: 30, locale: NS },
					(props) => h(TurnTimer, { ...props, t }),
				);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		/* Picked up by selftest.mjs: the render function and its clock copy are
		 * pure, so they are tested directly rather than through a fake renderer. */
		exports.internals = { TurnTimer, formatDuration, NS, inject };
		return module.exports;
	},
});
