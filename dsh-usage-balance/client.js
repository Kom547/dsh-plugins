window.__ModuleLoader__.load({
	id: '@local/dsh-usage-balance',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const react = require('react');
		const h = react.createElement;

		/* ── locale copy ─────────────────────────────────────────────────────
		 * Visible text goes through the Client locale service, so the entry
		 * follows a locale switch without re-registering.
		 */
		const NS = 'usageBalance';
		const zh = {
			group: '会话用量与账户余额',
			usage: '会话用量',
			usageExact: '未缓存输入 {input} · 缓存读 {cacheRead} · 输出 {output}',
			cache: '命中 {percent}%',
			balance: '余额',
			labels: '充值 {toppedUp} · 赠送 {bonus}',
			loading: '读取中…',
			unavailable: '余额不可用',
			signedOut: '未登录',
			refreshed: '更新于 {time}',
			refresh: '刷新余额',
		};
		const en = {
			group: 'Session usage and account balance',
			usage: 'Session usage',
			usageExact: 'uncached input {input} · cache read {cacheRead} · output {output}',
			cache: 'hit {percent}%',
			balance: 'Balance',
			labels: 'Topped up {toppedUp} · granted {bonus}',
			loading: 'Loading…',
			unavailable: 'Balance unavailable',
			signedOut: 'Signed out',
			refreshed: 'updated {time}',
			refresh: 'Refresh balance',
		};

		/* ── formatting ───────────────────────────────────────────────────── */

		/**
		 * Group an integer with thousands separators. Deliberately free of
		 * `Intl`/`toLocaleString`: those throw a RangeError on a language tag the
		 * runtime does not accept, and this runs inside the render pass.
		 * @param value - non-negative integer count.
		 * @returns the grouped integer.
		 */
		function exactCount(value) {
			const number = Number.isFinite(value) ? Math.round(value) : 0;
			const digits = String(Math.abs(number));
			let grouped = '';
			for (let end = digits.length; end > 0; end -= 3) {
				const start = Math.max(0, end - 3);
				grouped = digits.slice(start, end) + (grouped === '' ? '' : `,${grouped}`);
			}
			return number < 0 ? `-${grouped}` : grouped;
		}

		/** Symbol per currency; an unknown code keeps the code itself. */
		const CURRENCY_SYMBOL = { CNY: '¥', USD: '$' };

		/**
		 * Format one wallet amount: whole units stay whole, fractions show cents.
		 * Hand-formatted for the same reason as {@link exactCount} — no `Intl`.
		 * @param amount - decimal amount from the account service.
		 * @param currency - wallet currency.
		 * @returns the amount with its currency.
		 */
		function formatAmount(amount, currency) {
			const numeric = Number(amount);
			const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
			if (!Number.isFinite(numeric)) return `${symbol}${String(amount)}`;
			const digits = Number.isInteger(numeric) ? 0 : 2;
			const fixed = Math.abs(numeric).toFixed(digits);
			const [wholePart, fractionPart] = fixed.split('.');
			const grouped = exactCount(Number(wholePart));
			const body = fractionPart === undefined ? grouped : `${grouped}.${fractionPart}`;
			return numeric < 0 ? `-${symbol}${body}` : `${symbol}${body}`;
		}

		/**
		 * Local wall-clock time as HH:MM, without `Intl`.
		 * @param epochMs - millisecond timestamp.
		 * @returns the zero-padded time.
		 */
		function clockTime(epochMs) {
			const date = new Date(epochMs);
			const pad = (part) => String(part).padStart(2, '0');
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}

		/**
		 * Sum the wallets of one currency.
		 * @param wallets - wallet records.
		 * @returns their total, or null when no amount is numeric.
		 */
		function sumWallets(wallets) {
			let total = 0;
			let found = false;
			for (const wallet of wallets) {
				const numeric = Number(wallet.balance);
				if (!Number.isFinite(numeric)) continue;
				total += numeric;
				found = true;
			}
			return found ? total : null;
		}

		/**
		 * Project one balance outcome into the text the dock shows.
		 * @param state - latest balance outcome.
		 * @param t - bound locale seat.
		 * @returns the visible text and its hover title.
		 */
		function readBalance(state, t) {
			if (state.status === 'ready') {
				const wallets = state.value.value;
				const chosen = wallets[0];
				if (chosen === undefined) return { text: `${t('unavailable')} · no-wallet`, title: 'ready envelope carried no wallet' };
				const shared = (wallet) => wallet.currency === chosen.currency;
				const toppedUp = sumWallets(wallets.filter(shared)) ?? Number(chosen.balance);
				const bonus = sumWallets(state.value.bonusWallets.filter((wallet) => shared(wallet) && Number(wallet.balance) > 0));
				const toppedUpText = formatAmount(String(toppedUp), chosen.currency);
				const stamp = clockTime(state.at);
				if (bonus === null) return { text: toppedUpText, title: t('refreshed', { time: stamp }) };
				const bonusText = formatAmount(String(bonus), chosen.currency);
				return {
					text: `${toppedUpText} + ${bonusText}`,
					title: `${t('labels', { toppedUp: toppedUpText, bonus: bonusText })} · ${t('refreshed', { time: stamp })}`,
				};
			}
			if (state.status === 'signed-out') return { text: t('signedOut'), title: t('signedOut') };
			if (state.status === 'loading') return { text: t('loading'), title: '' };
			/* The reason rides in the visible text so a failure can be identified from
			 * a screenshot; the full envelope stays on the hover title. */
			const reason = typeof state.reason === 'string' && state.reason !== '' ? state.reason : 'unknown';
			return { text: `${t('unavailable')} · ${reason}`, title: reason };
		}

		/**
		 * Reduce any thrown value or error envelope to a short, screenshot-friendly
		 * token: its code/message head, never a stack.
		 * @param value - thrown value, or a result error envelope.
		 * @returns up to 48 characters, or the value's type when nothing readable.
		 */
		function shortError(value) {
			if (value === null || value === undefined) return 'nil';
			if (typeof value === 'string') return value.slice(0, 48);
			if (typeof value !== 'object') return String(value).slice(0, 48);
			const code = typeof value.code === 'string' ? value.code : '';
			const message = typeof value.message === 'string' ? value.message : '';
			const name = typeof value.name === 'string' ? value.name : '';
			const head = [code || name, message].filter((part) => part !== '').join(': ');
			return (head === '' ? Object.keys(value).slice(0, 4).join(',') || 'empty' : head).slice(0, 48);
		}

		/**
		 * Flatten a thrown value into one diagnosable line plus the first stack
		 * frames. React hands the boundary whatever was thrown, which is not
		 * always an Error and never survives `JSON.stringify`.
		 * @param error - the thrown value.
		 * @returns the tooltip text.
		 */
		function describeError(error) {
			if (error === null || error === undefined) return 'unknown failure';
			if (typeof error !== 'object') return String(error);
			const name = typeof error.name === 'string' ? error.name : 'Error';
			const message = typeof error.message === 'string' ? error.message : String(error);
			const stack = typeof error.stack === 'string'
				? error.stack.split('\n').slice(1, 4).map((line) => line.trim()).join('\n')
				: '';
			return stack === '' ? `${name}: ${message}` : `${name}: ${message}\n${stack}`;
		}

		/* ── styles ───────────────────────────────────────────────────────── */
		/* Typography and geometry copied from the shipped composer stats pill
		 * (`StatsPills.module.css`) so this entry reads as one more pill in the same
		 * row: the row sets no size of its own, every pill carries it. */
		const PILL_TEXT = {
			fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
			lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
		};

		const STYLE = {
			/* The strip is one pill: the dock already centres and gaps its entries. */
			root: {
				boxSizing: 'border-box',
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				minWidth: 0,
				maxWidth: '100%',
				padding: '1px 8px',
				borderRadius: '999px',
				color: 'var(--dsw-alias-label-tertiary)',
				fontVariantNumeric: 'tabular-nums',
				whiteSpace: 'nowrap',
				...PILL_TEXT,
			},
			refresh: {
				color: 'inherit',
				cursor: 'pointer',
				background: 'none',
				border: 'none',
				font: 'inherit',
				lineHeight: 0,
				padding: 0,
				display: 'inline-flex',
				alignItems: 'center',
			},
			icon: {
				display: 'block',
				flex: 'none',
				width: '14px',
				height: '14px',
			},
			separator: {
				color: 'var(--dsw-alias-separator-primary)',
				margin: '0 2px',
			},
		};

		/**
		 * Outline glyph in the host's icon size and stroke convention.
		 * @param props - the glyph outline.
		 * @returns the inline SVG icon.
		 */
		function Icon(props) {
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
				props.children,
			);
		}

		/** @returns the stacked-discs glyph marking the session usage group. */
		function IconDatabase() {
			return h(
				Icon,
				null,
				h('ellipse', { cx: '8', cy: '3.4', rx: '5.2', ry: '2.1' }),
				h('path', { d: 'M2.8 3.4v9.2c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V3.4' }),
				h('path', { d: 'M2.8 8c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1' }),
			);
		}

		/** @returns a circular arrow marking the manual refresh action. */
		function IconRefresh() {
			return h(
				Icon,
				null,
				h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.74' }),
				h('path', { d: 'M13.4 2.6v2.6h-2.6' }),
			);
		}

		/** @returns the wallet glyph marking the balance group. */
		function IconWallet() {
			return h(
				Icon,
				null,
				h('path', { d: 'M13.6 5.6V4.2a1.2 1.2 0 0 0-1.2-1.2H3.4a1.4 1.4 0 0 0 0 2.8h10.2v7.6a1.2 1.2 0 0 1-1.2 1.2H3.4a1.4 1.4 0 0 1-1.4-1.4V4.2' }),
				h('circle', { cx: '11.4', cy: '9.8', r: '.85', fill: 'currentColor', stroke: 'none' }),
			);
		}

		/* ── view ─────────────────────────────────────────────────────────── */

		/** Gap between automatic balance reads; each one costs a Platform request. */
		const REFRESH_INTERVAL_MS = 120000;
		/** Absence long enough to justify a read when the window comes back. */
		const FOCUS_GRACE_MS = 5000;

		/**
		 * Composer-dock entry: this session's billed token usage beside the
		 * signed-in account's balance, re-read on an interval, when the window
		 * returns, and on request.
		 *
		 * @param props - the dock entry's standard props plus this plugin's seats.
		 *   The locale service is deliberately NOT passed in: `props.locale` is the
		 *   entry's locale namespace (a string) and must stay that way, and the
		 *   engine already re-renders this entry on a locale switch.
		 * @returns the dock strip, or null while the session reports no usage.
		 */
		function UsageBalance(props) {
			const { t, readBalance: read } = props;
			const [balance, setBalance] = react.useState({ status: 'loading' });
			/* The seat never changes identity, so the effect below keeps stable
			 * dependencies and re-reads only on its own schedule. */
			const seat = react.useRef(read);
			seat.current = read;
			const alive = react.useRef(true);
			const reading = react.useRef(false);
			/* A null answer means "no account grant". Once a real wallet reading has
			 * arrived, a later null is a failed read and must not look like signing
			 * out; a `failed` status is equally inconclusive. */
			const seen = react.useRef(false);

			/**
			 * Read the balance once, without overlapping reads and without writing
			 * state after unmount.
			 * @returns Nothing.
			 */
			const refresh = react.useCallback(async () => {
				if (reading.current) return;
				reading.current = true;
				try {
					const outcome = await seat.current();
					if (!alive.current) return;
					if (outcome === null) {
						setBalance({ status: seen.current ? 'unavailable' : 'signed-out' });
						return;
					}
					if (outcome.status === 'ready') seen.current = true;
					setBalance(outcome);
				} catch {
					if (alive.current) setBalance({ status: 'unavailable' });
				} finally {
					reading.current = false;
				}
			}, []);

			react.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);

			/* Read on mount, then on the interval and when the window returns. */
			react.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
				let awaySince = document.visibilityState === 'hidden' ? Date.now() : null;
				const onVisibility = () => {
					if (document.visibilityState === 'hidden') {
						awaySince = Date.now();
						return;
					}
					const away = awaySince === null ? 0 : Date.now() - awaySince;
					awaySince = null;
					if (away >= FOCUS_GRACE_MS) refresh();
				};
				document.addEventListener('visibilitychange', onVisibility);
				return () => {
					clearInterval(timer);
					document.removeEventListener('visibilitychange', onVisibility);
				};
			}, [refresh]);

			/* The strip is the balance half only: the shipped composer stats pill already
			 * reports this session's token usage and cache hit rate beside it, so a second
			 * copy of the same numbers would be noise. Everything here still runs inside
			 * one try/catch: an unexpected shape degrades to a diagnostic label instead of
			 * blanking the dock. */
			try {
				if (balance.status === 'loading') return null;
				const price = readBalance(balance, t);
				return h(
					'span',
					{ style: STYLE.root, 'data-usage-balance': true, 'data-usage-balance-account': true },
					h(IconWallet),
					t('balance'),
					h('span', { style: STYLE.separator, 'aria-hidden': true }, '·'),
					h('span', { title: price.title, 'data-usage-balance-value': true }, price.text),
					h(
						'button',
						{
							type: 'button',
							style: STYLE.refresh,
							onClick: refresh,
							title: t('refresh'),
							'aria-label': t('refresh'),
						},
						h(IconRefresh),
					),
				);
			} catch (error) {
				const detail = describeError(error);
				return h(
					'div',
					{ style: STYLE.root, 'data-usage-balance-failed': true },
					h('span', { title: detail }, `用量 / 余额不可用 · ${detail.split('\n')[0].slice(0, 90)}`),
				);
			}
		}

		/* ── registration ─────────────────────────────────────────────────── */

		/**
		 * Contain a render failure to this entry. The dock owner renders every
		 * entry in one subtree, so a throw here would blank the strip; instead the
		 * dock shows the failure label in place. The message and the first stack
		 * frames go on the element's tooltip, so a failure that only reproduces in
		 * the running app is diagnosable without a debugger.
		 */
		class Guard extends react.Component {
			/** @returns the initial state: not yet failed. */
			constructor(props) {
				super(props);
				this.state = { failed: false, detail: '' };
			}

			/**
			 * Record the failure instead of unmounting the strip.
			 * @param error - the thrown value React caught.
			 * @returns the next state.
			 */
			static getDerivedStateFromError(error) {
				return { failed: true, detail: describeError(error) };
			}

			/** @returns the entry, or the failure label. @see react.Component */
			render() {
				if (!this.state.failed) return this.props.children;
				return h(
					'div',
					{ style: STYLE.root, 'data-usage-balance-failed': true },
					h('span', { title: this.state.detail }, '用量 / 余额不可用'),
				);
			}
		}

		/* `remote` is required IN ADDITION to `remote.account`: reaching the
		 * namespace through `ctx.remote` is itself a service access, and Cordis
		 * refuses it with "cannot get property \"remote\" without inject" when only
		 * the dotted leaf is declared. The shipped account plugin declares both. */
		const inject = ['slots', 'locale', 'remote', 'remote.account'];

		/**
		 * Register the dock entry and its dictionaries. Both live on this plugin's
		 * fiber, and the entry additionally collapses with the
		 * `conversation.composer.dock` declaration that owns it.
		 * @param ctx - client plugin context.
		 * @returns Nothing; every disposer belongs to the context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-balance: dictionaries');
			const t = ctx.locale.bind(NS);
			/* The account Remote is the whole account surface this entry needs, and
			 * it answers null when no account grant exists. The account settings
			 * plugin's `useAccount` hook is deliberately not used: that plugin
			 * activates only under the desktop `dsh-app://` origin, while this page
			 * is served over http, so the hook is absent here. */
			const readBalance = async () => {
				try {
					const result = await ctx.remote.account.getBalance({
						version: CLIENT_VERSION,
						locale: ctx.locale.getSnapshot().active,
						timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
					});
					/* Each failure keeps its own short reason. They are shown inline so a
					 * failure that only reproduces in this page is identifiable from a
					 * screenshot, without attaching a debugger. */
					if (!result.ok) return { status: 'unavailable', reason: `rpc ${shortError(result.error)}` };
					/* Only a delivered `null` means the host holds no account grant. */
					if (result.value === null) return null;
					if (result.value.status !== 'ready') return { status: 'unavailable', reason: `platform ${shortError(result.value)}` };
					return { status: 'ready', value: result.value, at: Date.now() };
				} catch (error) {
					return { status: 'unavailable', reason: `call ${shortError(error)}` };
				}
			};
			ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
				{
					name: 'conversation.composer.dock',
					id: 'usage-balance',
					order: 20,
					locale: NS,
					label: () => t('usage'),
				},
				(props) => h(Guard, null, h(UsageBalance, { ...props, readBalance, t })),
			));
		}

		/**
		 * Client identity the account Remote forwards to Platform as
		 * `x-client-version`. The web shell publishes no version global, so this
		 * is the plugin's own build number.
		 */
		const CLIENT_VERSION = '1.0.0';

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
